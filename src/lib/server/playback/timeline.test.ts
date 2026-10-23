import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakePms } from '../../../../test/fake-pms/server';
import { users } from '../db/schema';
import { pollLink, startLink } from '../plex/link';
import { plexFor } from '../plex/session';
import { insertUser, testDb } from '../test-utils';
import { allPlaybacks, createPlayback } from './sessions';
import { reportTimeline, STALE_AFTER, sweepStalePlaybacks, watchedThreshold } from './timeline';
import { makeItem } from '#lib/test-items.js';

const pms = createFakePms();
const db = testDb();
let userId: string;

beforeAll(async () => {
	process.env.PUBLIC_ORIGIN = 'https://plex.example.com';
	process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
	const base = `http://127.0.0.1:${await pms.listen()}`;
	process.env.PLEX_TV_URL = `${base}/plextv`;
	await startLink(db, `${base}/plextv`, base);
	await fetch(`${base}/__fake/approve-pins`, { method: 'POST' });
	await pollLink(db, `${base}/plextv`);
	userId = insertUser(db, { plexHomeUserUuid: pms.ownerUuid }).id;
});
afterAll(() => pms.close());

function playback(method: 'directplay' | 'transcode') {
	return createPlayback({
		plexSession: `sess-${method}-${Math.random()}`,
		appSessionHash: 'app',
		userId,
		ratingKey: '160',
		mediaIndex: 0,
		partIndex: 0,
		partId: 340,
		partKey: '/library/parts/340/1/file.mkv',
		method,
		reason: undefined,
		quality: 'original',
		caps: { containers: [], video: [], audio: [], hdr: false, nativeHls: false, mse: true },
		device: { clientIdentifier: 'plex-web-device', deviceName: 'Test' },
		streamOffset: 0,
		startAt: 0,
		duration: 6_454_912,
		subtitleMode: 'none',
		subtitle: null,
		watchedAt: 5_000_000
	});
}

describe('timeline reporting', () => {
	it('forwards state, time and session to PMS', async () => {
		const plex = plexFor(db, db.select().from(users).all()[0]);
		const p = playback('directplay');
		await reportTimeline(plex, p, { state: 'playing', time: 30_000 });
		expect(pms.state.timelines.at(-1)).toMatchObject({
			ratingKey: '160',
			key: '/library/metadata/160',
			state: 'playing',
			time: '30000',
			duration: '6454912',
			session: p.plexSession
		});
	});

	it('sweeps abandoned playbacks: final report and transcode stop', async () => {
		const plex = plexFor(db, db.select().from(users).all()[0]);
		const p = playback('transcode');
		await reportTimeline(plex, p, { state: 'playing', time: 61_000 });
		pms.state.transcodes.set(p.plexSession, { query: {}, stopped: false, startedAt: 0 });

		expect(await sweepStalePlaybacks(db, Date.now())).toBe(0);
		expect(await sweepStalePlaybacks(db, Date.now() + STALE_AFTER + 1)).toBeGreaterThanOrEqual(1);
		expect(allPlaybacks().some((x) => x.id === p.id)).toBe(false);
		expect(pms.state.transcodes.get(p.plexSession)?.stopped).toBe(true);
		const last = pms.state.timelines.filter((t) => t.session === p.plexSession).at(-1);
		expect(last).toMatchObject({ state: 'stopped', time: '61000' });
	});
});

describe('automatic mark as watched', () => {
	it('uses the credits marker, else 90% of the duration, and never for extras', () => {
		expect(watchedThreshold(makeItem({ duration: 100 * 60_000 }))).toBe(90 * 60_000);
		expect(
			watchedThreshold(
				makeItem({
					duration: 100 * 60_000,
					markers: [{ type: 'credits', start: 95 * 60_000, end: 100 * 60_000, final: true }]
				})
			)
		).toBe(95 * 60_000);
		expect(watchedThreshold(makeItem({ type: 'clip', duration: 150_000 }))).toBeNull();
	});

	it('scrobbles once when playback passes the threshold', async () => {
		const plex = plexFor(db, db.select().from(users).all()[0]);
		const p = playback('directplay');
		const scrobbles = () =>
			pms.state.requests.filter((r) => r.path === '/:/scrobble' && r.query.key === '160').length;
		const before = scrobbles();
		await reportTimeline(plex, p, { state: 'playing', time: 4_999_000 });
		expect(scrobbles()).toBe(before);
		await reportTimeline(plex, p, { state: 'playing', time: 5_000_000 });
		await reportTimeline(plex, p, { state: 'playing', time: 5_010_000 });
		expect(scrobbles()).toBe(before + 1);
	});

	it('never scrobbles extras', async () => {
		const plex = plexFor(db, db.select().from(users).all()[0]);
		const p = { ...playback('directplay'), watchedAt: null };
		const before = pms.state.requests.filter((r) => r.path === '/:/scrobble').length;
		await reportTimeline(plex, p, { state: 'stopped', time: 9_999_999 });
		expect(pms.state.requests.filter((r) => r.path === '/:/scrobble').length).toBe(before);
	});
});
