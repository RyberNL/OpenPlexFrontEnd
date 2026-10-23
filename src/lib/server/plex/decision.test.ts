import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MediaVersion, Stream } from '#lib/plex-types.js';
import type { Capabilities } from '#lib/playback.js';
import {
	clientProfileExtra,
	localDecision,
	pmsDecision,
	streamQuery,
	type StreamRequest
} from './decision';
import { toMediaItem } from './normalize';
import { containerSchema } from './schemas';
import type { PlexSession } from './session';

/** A typical desktop Chrome. */
const chrome: Capabilities = {
	containers: ['mp4', 'm4v', 'webm'],
	video: ['h264', 'av1', 'vp9'],
	audio: ['aac', 'mp3', 'opus', 'flac'],
	hdr: false,
	nativeHls: false,
	mse: true
};

const recorded = toMediaItem(
	containerSchema.parse(JSON.parse(fs.readFileSync('test/fixtures/plex/movie-detail.json', 'utf8')))
		.MediaContainer.Metadata![0]
).versions[0];

function version(overrides: Partial<MediaVersion>, audioCodec: string): [MediaVersion, Stream] {
	const audio: Stream = {
		id: 1,
		type: 'audio',
		codec: audioCodec,
		selected: true,
		default: true,
		forced: false,
		external: false
	};
	return [{ ...recorded, hdr: undefined, ...overrides }, audio];
}

describe('localDecision', () => {
	it('direct-plays an H.264/AAC MP4 at Original quality', () => {
		const [v, a] = version(
			{ container: 'mov,mp4,m4a', videoCodec: 'h264', audioCodec: 'aac' },
			'aac'
		);
		expect(localDecision(v, a, chrome, 'original')).toEqual({ method: 'directplay' });
	});

	it('sends an HEVC/DTS MKV through HLS, naming the video codec', () => {
		const [v, a] = version({ container: 'mkv', videoCodec: 'hevc', audioCodec: 'dca' }, 'dca');
		expect(localDecision(v, a, chrome, 'original')).toEqual({
			method: 'hls',
			reason: 'HEVC video is not supported by this browser'
		});
	});

	it('names an unsupported audio codec when the video is fine', () => {
		const [v, a] = version({ container: 'mkv', videoCodec: 'h264', audioCodec: 'dca' }, 'dca');
		expect(localDecision(v, a, chrome, 'original')).toEqual({
			method: 'hls',
			reason: 'DTS audio is not supported by this browser'
		});
	});

	it('names the container when only the container is the problem', () => {
		const [v, a] = version({ container: 'mkv', videoCodec: 'h264', audioCodec: 'aac' }, 'aac');
		expect(localDecision(v, a, chrome, 'original')).toEqual({
			method: 'hls',
			reason: "MKV files can't be played directly by this browser"
		});
	});

	it('converts HDR for SDR displays and honours lower quality settings', () => {
		const [hdr, a] = version(
			{ container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', hdr: 'HDR10' },
			'aac'
		);
		expect(localDecision(hdr, a, chrome, 'original')).toMatchObject({
			reason: 'HDR10 needs an HDR display; converting to SDR'
		});
		expect(localDecision(hdr, a, { ...chrome, hdr: true }, 'original').method).toBe('directplay');
		const [plain] = version({ container: 'mp4', videoCodec: 'h264', audioCodec: 'aac' }, 'aac');
		expect(localDecision(plain, a, chrome, '720p-2')).toEqual({
			method: 'hls',
			reason: 'Quality set to 720p · 2 Mbps'
		});
	});

	it('uses the recorded 4K HEVC HDR movie as a realistic transcode case', () => {
		const audio = recorded.parts[0].streams.find((s) => s.type === 'audio' && s.selected);
		expect(localDecision(recorded, audio, chrome, 'original').method).toBe('hls');
	});
});

describe('PMS decision', () => {
	const request: StreamRequest = {
		ratingKey: '160',
		mediaIndex: 0,
		partIndex: 0,
		quality: 'original',
		caps: chrome,
		session: 'sess-1',
		device: { clientIdentifier: 'device-1', deviceName: 'Chrome on Linux' },
		offset: 42.7
	};

	it('requests HLS with the session, offset and a client profile', () => {
		expect(streamQuery(request)).toMatchObject({
			path: '/library/metadata/160',
			protocol: 'hls',
			directPlay: 0,
			directStream: 1,
			session: 'sess-1',
			'X-Plex-Session-Identifier': 'sess-1',
			offset: 42,
			subtitles: 'none'
		});
		expect(streamQuery({ ...request, quality: '720p-2' })).toMatchObject({
			directStream: 0,
			maxVideoBitrate: 2000,
			videoResolution: '1280x720'
		});
		expect(clientProfileExtra(chrome)).toContain('videoCodec=h264&audioCodec=aac,mp3');
		expect(
			clientProfileExtra({
				...chrome,
				video: ['h264', 'hevc'],
				nativeHls: true,
				audio: ['aac', 'eac3']
			})
		).toContain('videoCodec=h264,hevc&audioCodec=aac,eac3');
	});

	function stub(body: unknown) {
		return {
			json: async (_path: string, schema: { parse: (v: unknown) => unknown }) => schema.parse(body)
		} as unknown as PlexSession;
	}

	it('maps the recorded transcode decision', async () => {
		const body = JSON.parse(fs.readFileSync('test/fixtures/plex/movie-decision.json', 'utf8'));
		expect(await pmsDecision(stub(body), request)).toEqual({
			method: 'transcode',
			reason: 'Direct play not available; Conversion OK.'
		});
	});

	it('recognises direct stream (video copied)', async () => {
		const body = {
			MediaContainer: {
				generalDecisionCode: 1001,
				Metadata: [
					{
						Media: [
							{
								Part: [
									{
										decision: 'transcode',
										Stream: [
											{ id: 1, streamType: 1, decision: 'copy' },
											{ id: 2, streamType: 2, decision: 'transcode' }
										]
									}
								]
							}
						]
					}
				]
			}
		};
		expect((await pmsDecision(stub(body), request)).method).toBe('directstream');
	});

	it('fails clearly when PMS cannot play the item', async () => {
		const body = {
			MediaContainer: { generalDecisionCode: 2000, generalDecisionText: 'Cannot play' }
		};
		await expect(pmsDecision(stub(body), request)).rejects.toThrow('Cannot play');
	});
});
