import { z } from 'zod';
import type { MediaVersion, Stream } from '#lib/plex-types.js';
import {
	QUALITY_PRESETS,
	type Capabilities,
	type PlaybackMethod,
	type Quality
} from '#lib/playback.js';
import { plexId, type ClientIdentity } from './http';
import type { PlexSession } from './session';

const CODEC_NAMES: Record<string, string> = {
	h264: 'H.264',
	hevc: 'HEVC',
	av1: 'AV1',
	vp9: 'VP9',
	mpeg2video: 'MPEG-2',
	vc1: 'VC-1',
	aac: 'AAC',
	ac3: 'Dolby Digital',
	eac3: 'Dolby Digital Plus',
	truehd: 'Dolby TrueHD',
	dca: 'DTS',
	dts: 'DTS',
	flac: 'FLAC',
	opus: 'Opus',
	mp3: 'MP3',
	pcm: 'PCM'
};
const name = (codec: string) => CODEC_NAMES[codec] ?? codec.toUpperCase();

/** Containers whose files are equivalent for <video> (Plex reports e.g. "mov,mp4,m4a"). */
function containers(container: string | undefined) {
	return (container ?? '')
		.toLowerCase()
		.split(',')
		.map((c) => c.trim())
		.filter(Boolean);
}

export type LocalDecision = { method: 'directplay' } | { method: 'hls'; reason: string };

/**
 * Whether the browser can play the file as-is. Anything else goes through PMS as HLS; the reason
 * is shown in the File info panel.
 */
export function localDecision(
	version: MediaVersion,
	audio: Stream | undefined,
	caps: Capabilities,
	quality: Quality
): LocalDecision {
	const video = version.videoCodec?.toLowerCase();
	const audioCodec = (audio?.codec ?? version.audioCodec)?.toLowerCase();
	if (quality !== 'original') {
		return { method: 'hls', reason: `Quality set to ${QUALITY_PRESETS[quality].label}` };
	}
	if (video && !caps.video.includes(video)) {
		return { method: 'hls', reason: `${name(video)} video is not supported by this browser` };
	}
	if (version.hdr && !caps.hdr) {
		return { method: 'hls', reason: `${version.hdr} needs an HDR display; converting to SDR` };
	}
	if (audioCodec && !caps.audio.includes(audioCodec)) {
		return { method: 'hls', reason: `${name(audioCodec)} audio is not supported by this browser` };
	}
	const formats = containers(version.container);
	if (!formats.some((c) => caps.containers.includes(c))) {
		return {
			method: 'hls',
			reason: `${(formats[0] ?? 'This').toUpperCase()} files can't be played directly by this browser`
		};
	}
	return { method: 'directplay' };
}

/** Tells PMS what the browser can receive over HLS, so it copies streams instead of converting. */
export function clientProfileExtra(caps: Capabilities) {
	const video = ['h264', ...caps.video.filter((c) => c === 'hevc' && caps.nativeHls)];
	const audio = ['aac', ...caps.audio.filter((c) => c === 'ac3' || c === 'eac3' || c === 'mp3')];
	return [
		`add-transcode-target(type=videoProfile&context=streaming&protocol=hls&container=mpegts&videoCodec=${video.join(',')}&audioCodec=${[...new Set(audio)].join(',')})`,
		'add-transcode-target(type=subtitleProfile&context=streaming&protocol=hls&container=webvtt&subtitleCodec=webvtt)'
	].join('+');
}

const streamDecision = z.looseObject({
	id: z.coerce.string(),
	streamType: z.coerce.number(),
	decision: z.string().optional()
});

const decisionSchema = z.object({
	MediaContainer: z.looseObject({
		generalDecisionCode: z.coerce.number().optional(),
		generalDecisionText: z.string().optional(),
		transcodeDecisionText: z.string().optional(),
		Metadata: z
			.array(
				z.looseObject({
					Media: z
						.array(
							z.looseObject({
								Part: z
									.array(
										z.looseObject({
											decision: z.string().optional(),
											Stream: z.array(streamDecision).optional()
										})
									)
									.optional()
							})
						)
						.optional()
				})
			)
			.optional()
	})
});

export class PlaybackError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PlaybackError';
	}
}

export type StreamRequest = {
	ratingKey: string;
	mediaIndex: number;
	partIndex: number;
	quality: Quality;
	caps: Capabilities;
	/** Plex playback session id (one per player instance). */
	session: string;
	device: ClientIdentity;
	/** Seconds into the item to start the stream. */
	offset?: number;
	/**
	 * none: no subtitles; auto: PMS delivers the selected text subtitle separately
	 * (/video/:/transcode/universal/subtitles); burn: burned into the video (image subtitles).
	 */
	subtitleMode?: 'none' | 'auto' | 'burn';
};

/** Query parameters shared by the decision and the HLS start request. */
export function streamQuery(request: StreamRequest) {
	const preset = QUALITY_PRESETS[request.quality];
	return {
		path: `/library/metadata/${plexId(request.ratingKey)}`,
		mediaIndex: request.mediaIndex,
		partIndex: request.partIndex,
		protocol: 'hls',
		directPlay: 0,
		directStream: request.quality === 'original' ? 1 : 0,
		directStreamAudio: 1,
		fastSeek: 1,
		copyts: 1,
		videoQuality: 100,
		maxVideoBitrate: preset.maxVideoBitrate,
		videoResolution: preset.resolution,
		offset: request.offset ? Math.floor(request.offset) : undefined,
		subtitles: request.subtitleMode ?? 'none',
		session: request.session,
		'X-Plex-Session-Identifier': request.session,
		location: 'lan'
	};
}

export function streamHeaders(request: StreamRequest) {
	return { 'X-Plex-Client-Profile-Extra': clientProfileExtra(request.caps) };
}

/** Asks PMS how it would stream the item over HLS: copying (direct stream) or converting. */
export async function pmsDecision(
	plex: PlexSession,
	request: StreamRequest
): Promise<{ method: Exclude<PlaybackMethod, 'directplay'>; reason: string | undefined }> {
	const result = await plex.json('/video/:/transcode/universal/decision', decisionSchema, {
		query: streamQuery(request),
		headers: streamHeaders(request),
		identity: request.device
	});
	const container = result.MediaContainer;
	if ((container.generalDecisionCode ?? 1000) >= 2000) {
		throw new PlaybackError(container.generalDecisionText ?? 'The server cannot play this item.');
	}
	const part = container.Metadata?.[0]?.Media?.[0]?.Part?.[0];
	const video = part?.Stream?.find((s) => s.streamType === 1);
	const copiesVideo = video?.decision === 'copy' || part?.decision === 'copy';
	return {
		method: copiesVideo ? 'directstream' : 'transcode',
		reason: container.transcodeDecisionText
	};
}

/** Direct play when the browser can handle the file; otherwise PMS's HLS decision. */
export async function decidePlayback(
	plex: PlexSession,
	request: StreamRequest,
	version: MediaVersion,
	audio: Stream | undefined
): Promise<{ method: PlaybackMethod; reason: string | undefined }> {
	const local = localDecision(version, audio, request.caps, request.quality);
	if (local.method === 'directplay') return { method: 'directplay', reason: undefined };
	const pms = await pmsDecision(plex, request);
	return { method: pms.method, reason: local.reason ?? pms.reason };
}
