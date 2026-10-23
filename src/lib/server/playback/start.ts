import { z } from 'zod';
import type { MediaItem } from '#lib/plex-types.js';
import { isQuality, METHOD_LABELS, type Capabilities, type Quality } from '#lib/playback.js';
import { describeUserAgent } from '#lib/user-agent.js';
import type { User } from '../auth/session';
import { decidePlayback, pmsDecision } from '../plex/decision';
import { PlexNotFoundError } from '../plex/errors';
import { plexId, type ClientIdentity } from '../plex/http';
import { presentItem } from '../plex/images';
import { toMediaItem } from '../plex/normalize';
import { containerSchema } from '../plex/schemas';
import type { PlexSession } from '../plex/session';
import { createPlayback, newPlexSessionId, type PlaybackSession } from './sessions';
import { watchedThreshold } from './timeline';

export const startRequestSchema = z.object({
	ratingKey: z.string().regex(/^\d{1,12}$/),
	from: z.enum(['resume', 'start']).default('start'),
	/** Explicit position (ms), e.g. when switching quality mid-stream. */
	offset: z.number().int().min(0).optional(),
	version: z.number().int().optional(),
	quality: z.string().refine(isQuality).default('original'),
	caps: z.object({
		containers: z.array(z.string().max(16)).max(16),
		video: z.array(z.string().max(16)).max(16),
		audio: z.array(z.string().max(16)).max(16),
		hdr: z.boolean(),
		nativeHls: z.boolean(),
		mse: z.boolean()
	}),
	deviceId: z.string().regex(/^[\w-]{8,64}$/),
	burnSubtitles: z.boolean().default(false)
});
export type StartRequest = z.infer<typeof startRequestSchema>;

export class UnavailableError extends Error {
	constructor(message = 'This file is currently unavailable on the server.') {
		super(message);
		this.name = 'UnavailableError';
	}
}

/** Item details plus the server-only PMS path of each part. */
async function playableItem(plex: PlexSession, ratingKey: string) {
	const result = await plex.json(`/library/metadata/${plexId(ratingKey)}`, containerSchema, {
		query: { includeMarkers: 1, includeChapters: 1 }
	});
	const raw = result.MediaContainer.Metadata?.[0];
	if (!raw) throw new PlexNotFoundError();
	const partKeys = new Map(
		(raw.Media ?? []).flatMap((m) =>
			(m.Part ?? []).flatMap((p) => (p.id !== undefined && p.key ? [[p.id, p.key]] : []))
		)
	);
	return { item: presentItem(toMediaItem(raw)), partKeys };
}

/** Subtitle formats the browser can render itself (as text or, for ASS/SSA, with styling). */
export const TEXT_SUBTITLE_CODECS = new Set([
	'srt',
	'subrip',
	'ass',
	'ssa',
	'mov_text',
	'tx3g',
	'vtt',
	'webvtt',
	'smi',
	'text'
]);

/** PGS as a sidecar file is drawn by the browser (libpgs); other image subtitles are burned in. */
const PGS_CODECS = new Set(['pgs', 'hdmv_pgs_subtitle']);

export type PlaybackInfo = {
	playbackId: string;
	src: string;
	kind: 'file' | 'hls';
	method: PlaybackSession['method'];
	methodLabel: string;
	reason: string | undefined;
	/** Where the stream's time 0 lies within the item (ms): 0, see PlaybackSession. */
	streamOffset: number;
	/** Where to start playing within the item (ms). */
	startAt: number;
	quality: Quality;
	versionId: number;
	/** The selected browser-rendered subtitle and where the player fetches it; null when off. */
	subtitle: { streamId: number; codec: string; url: string } | null;
	/** Preview thumbnails for scrubbing (`?t=<ms>` gives the frame at that time); null if none. */
	previews: string | null;
	item: MediaItem;
};

/** Decides how to play an item for this browser and creates the playback session. */
export async function startPlayback(
	plex: PlexSession,
	user: User,
	appSessionHash: string,
	request: StartRequest,
	userAgent: string | null
): Promise<PlaybackInfo> {
	const { item, partKeys } = await playableItem(plex, request.ratingKey);
	const mediaIndex = Math.max(
		0,
		item.versions.findIndex((v) => v.id === request.version)
	);
	const version = item.versions[mediaIndex];
	const part = version?.parts[0];
	const partKey = part && partKeys.get(part.id);
	if (!version || !part || !partKey || !part.accessible) throw new UnavailableError();

	const caps: Capabilities = request.caps;
	const quality = request.quality as Quality;
	const device: ClientIdentity = {
		clientIdentifier: `plex-web-${request.deviceId}`,
		deviceName: describeUserAgent(userAgent),
		platform: 'Web'
	};
	const startAt =
		request.offset ?? (request.from === 'resume' && item.viewOffset ? item.viewOffset : 0);
	const audio =
		part.streams.find((s) => s.type === 'audio' && s.selected) ??
		part.streams.find((s) => s.type === 'audio');

	const subtitle = part.streams.find((s) => s.type === 'subtitle' && s.selected) ?? null;
	const textSubtitle = subtitle && TEXT_SUBTITLE_CODECS.has(subtitle.codec ?? '') ? subtitle : null;
	const pgsFile = subtitle?.external && PGS_CODECS.has(subtitle.codec ?? '') ? subtitle : null;
	// Any other image subtitle (embedded PGS, VobSub, DVB) can only be shown burned in.
	const burn = request.burnSubtitles || (!!subtitle && !textSubtitle && !pgsFile);
	const subtitleMode = burn ? 'burn' : textSubtitle ? 'auto' : 'none';
	const shownSubtitle = burn ? null : (textSubtitle ?? pgsFile);

	const plexSession = newPlexSessionId();
	const streamRequest = {
		ratingKey: item.id,
		mediaIndex,
		partIndex: 0,
		quality,
		caps,
		session: plexSession,
		device,
		offset: startAt / 1000,
		subtitleMode
	} as const;
	const audioTracks = part.streams.filter((s) => s.type === 'audio');
	// Browsers can't switch the audio track of a file they play directly, so another track
	// than the file's first one is delivered by PMS instead.
	const otherAudioTrack = audioTracks.length > 1 && audio?.id !== audioTracks[0].id;
	// Likewise, embedded subtitles (and burned-in ones) can only come from PMS.
	const serverReason = otherAudioTrack
		? `The ${audio?.language ?? 'selected'} audio track is streamed by the server`
		: subtitleMode === 'burn'
			? 'Image subtitles are burned into the video by the server'
			: textSubtitle && !textSubtitle.external
				? 'Embedded subtitles are delivered by the server'
				: null;
	const decision = serverReason
		? { ...(await pmsDecision(plex, streamRequest)), reason: serverReason }
		: await decidePlayback(plex, streamRequest, version, audio);
	const direct = decision.method === 'directplay';
	const session = createPlayback({
		plexSession,
		appSessionHash,
		userId: user.id,
		ratingKey: item.id,
		mediaIndex,
		partIndex: 0,
		partId: part.id,
		partKey,
		method: decision.method,
		reason: decision.reason,
		quality,
		caps,
		device,
		// PMS's HLS playlist covers the whole item, like a direct file; the player seeks to startAt.
		streamOffset: 0,
		startAt,
		duration: item.duration ?? version.duration ?? 0,
		subtitleMode,
		subtitle: shownSubtitle
			? {
					streamId: shownSubtitle.id,
					delivery: pgsFile || decision.method === 'directplay' ? 'file' : 'stream',
					image: !!pgsFile
				}
			: null,
		watchedAt: watchedThreshold(item)
	});
	return {
		playbackId: session.id,
		src: direct ? `/stream/${session.id}/file` : `/stream/${session.id}/master.m3u8`,
		kind: direct ? 'file' : 'hls',
		method: decision.method,
		methodLabel: METHOD_LABELS[decision.method],
		reason: decision.reason,
		streamOffset: session.streamOffset,
		startAt,
		quality,
		versionId: version.id,
		subtitle: session.subtitle && {
			streamId: session.subtitle.streamId,
			codec: pgsFile ? 'pgs' : (shownSubtitle!.codec ?? ''),
			url: `/stream/${session.id}/subtitles`
		},
		previews: part.previews ? `/stream/${session.id}/preview` : null,
		item
	};
}
