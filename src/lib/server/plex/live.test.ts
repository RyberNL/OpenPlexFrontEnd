/**
 * Opt-in checks against the real Plex server and plex.tv. Skipped unless PLEX_LIVE=1.
 *
 *   PLEX_LIVE=1 PLEX_URL=http://192.168.1.10:32400 PLEX_ACCOUNT_TOKEN=<owner plex.tv token> \
 *     npx vitest run src/lib/server/plex/live.test.ts
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { testDb } from '../test-utils';
import { plexFetch, plexJson } from './http';
import { checkServer } from './link';
import { sectionsSchema } from './schemas';

const live = process.env.PLEX_LIVE === '1';
const PLEX_URL = process.env.PLEX_URL ?? 'http://192.168.1.10:32400';
const ACCOUNT_TOKEN = process.env.PLEX_ACCOUNT_TOKEN ?? '';
const identity = { clientIdentifier: 'plex-web-live-test', deviceName: 'Live test' };

describe.skipIf(!live)('live Plex server', () => {
	it('links: identity, owned resource and a working server token', async () => {
		process.env.PUBLIC_ORIGIN ??= 'https://plex.example.com';
		process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64');
		const server = await checkServer(testDb(), PLEX_URL);
		expect(server.machineIdentifier).toMatch(/^[0-9a-f]{40}$/);

		const resources = await plexJson(
			'https://plex.tv',
			'/api/v2/resources',
			z.array(
				z.looseObject({
					clientIdentifier: z.string(),
					owned: z.boolean(),
					accessToken: z.string().nullish()
				})
			),
			{ identity, token: ACCOUNT_TOKEN, query: { includeHttps: 1, includeRelay: 0 } }
		);
		const resource = resources.find((r) => r.clientIdentifier === server.machineIdentifier);
		expect(resource?.owned).toBe(true);
		expect(resource?.accessToken).toBeTruthy();

		const sections = await plexJson(PLEX_URL, '/library/sections', sectionsSchema, {
			identity,
			token: resource!.accessToken
		});
		expect(sections.MediaContainer.Directory?.length).toBeGreaterThan(0);
	});
});

/** The owned server's access token (the account may also see servers shared with it). */
async function serverToken() {
	const machine = await plexJson(
		PLEX_URL,
		'/identity',
		z.object({ MediaContainer: z.looseObject({ machineIdentifier: z.string() }) }),
		{ identity }
	);
	const resources = await plexJson(
		'https://plex.tv',
		'/api/v2/resources',
		z.array(
			z.looseObject({
				clientIdentifier: z.string(),
				owned: z.boolean().optional(),
				accessToken: z.string().nullish()
			})
		),
		{ identity, token: ACCOUNT_TOKEN, query: { includeHttps: 1, includeRelay: 0 } }
	);
	const own = resources.find(
		(r) => r.clientIdentifier === machine.MediaContainer.machineIdentifier && r.owned
	);
	return own!.accessToken!;
}

/** A PlexSession on the real server with a fixed token (no app database involved). */
function realSession(token: string) {
	return {
		serverUrl: PLEX_URL,
		token: async () => token,
		json: (path: string, schema: z.ZodType, options: Record<string, unknown> = {}) =>
			plexJson(PLEX_URL, path, schema, { identity, ...options, token } as never),
		fetch: (path: string, options: Record<string, unknown> = {}) =>
			plexFetch(PLEX_URL, path, { identity, ...options, token } as never)
	} as never;
}

describe.skipIf(!live)('live playback decision', () => {
	it('gets HLS decisions for the 4K HEVC HDR movie for a Chrome- and a Safari-like client', async () => {
		const { pmsDecision } = await import('./decision');
		const session = realSession;
		const token = await serverToken();
		const base = {
			ratingKey: '160',
			mediaIndex: 0,
			partIndex: 0,
			quality: 'original' as const,
			session: 'live-test',
			device: { clientIdentifier: 'plex-web-live-test', deviceName: 'Live test' }
		};
		const chrome = {
			containers: ['mp4'],
			video: ['h264'],
			audio: ['aac'],
			hdr: false,
			nativeHls: false,
			mse: true
		};
		const safari = {
			containers: ['mp4'],
			video: ['h264', 'hevc'],
			audio: ['aac', 'ac3', 'eac3'],
			hdr: true,
			nativeHls: true,
			mse: true
		};
		const forChrome = await pmsDecision(session(token), { ...base, caps: chrome });
		const forSafari = await pmsDecision(session(token), { ...base, caps: safari });
		console.log('chrome →', forChrome, '| safari →', forSafari);
		expect(forChrome.method).toBe('transcode');
		expect(['directstream', 'transcode']).toContain(forSafari.method);

		// H.264/AAC in MKV: only the container differs, so PMS should copy the streams.
		const remux = await pmsDecision(session(token), { ...base, ratingKey: '165', caps: chrome });
		console.log('mkv h264/aac →', remux);
		expect(remux.method).toBe('directstream');
	});
});

describe.skipIf(!live)('live TV on the real DVR', () => {
	it('tunes a channel, starts its stream, and frees the tuner when the playback ends', async () => {
		const { liveTv } = await import('./api');
		const { channels } = await import('./livetv');
		const { startLive } = await import('../playback/live');
		const { getPlayback } = await import('../playback/sessions');
		const { hlsRequest } = await import('../playback/relay');
		const { endPlayback } = await import('../playback/timeline');
		const { TRANSCODE_BASE } = await import('../playback/playlist');
		const plex: import('./session').PlexSession = realSession(await serverToken());
		const sessions = z.object({ MediaContainer: z.looseObject({ size: z.number() }) });
		const liveSessions = async () =>
			(await plex.json('/livetv/sessions', sessions)).MediaContainer.size;

		const dvr = await liveTv(plex);
		expect(dvr).not.toBeNull();
		if ((await liveSessions()) > 0) {
			console.log('Tuner in use; skipping the tune check so nobody is interrupted.');
			return;
		}
		const lineup = await channels(plex, dvr!);
		const info = await startLive(
			plex,
			{ id: 'live-test' } as never,
			'live-test',
			{
				channel: lineup.find((c) => c.title.includes('NPO 1'))?.id ?? lineup[0].id,
				quality: 'original',
				caps: {
					containers: ['mp4'],
					video: ['h264'],
					audio: ['aac'],
					hdr: false,
					nativeHls: false,
					mse: true
				},
				deviceId: 'live-test-0001'
			},
			null
		);
		const playback = getPlayback(info.playbackId, 'live-test')!;
		try {
			console.log('live →', info.method, info.airing?.title ?? '(no guide entry)');
			expect(playback.live?.grabKey).toMatch(/^\/media\/grabbers\/operations\//);
			// The tuner belongs to the playback's session, which its timeline reports keep alive.
			expect(playback.live?.grabKey).toMatch(new RegExp(`-${playback.plexSession}$`));
			const { query, headers } = hlsRequest(playback);
			const master = await plex.fetch(`${TRANSCODE_BASE}start.m3u8`, {
				query,
				headers: { ...headers, Accept: '*/*' },
				identity: playback.device,
				timeout: 30_000
			});
			expect(await master.text()).toContain('#EXTM3U');
			expect(await liveSessions()).toBe(1);
		} finally {
			await endPlayback(plex, playback);
		}
		await expect.poll(liveSessions, { timeout: 15_000, interval: 1000 }).toBe(0);
	}, 60_000);
});
