import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFakePms } from '../../../../test/fake-pms/server';
import type { DB } from '../db';
import { users } from '../db/schema';
import { insertUser, testDb } from '../test-utils';
import { discover, libraries } from './api';
import { pollLink, startLink } from './link';
import { plexFor, type PlexSession } from './session';

const pms = createFakePms();
let base: string;
let db: DB;
let plex: PlexSession;

beforeAll(async () => {
	process.env.PUBLIC_ORIGIN = 'https://plex.example.com';
	process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
	base = `http://127.0.0.1:${await pms.listen()}`;
	process.env.PLEX_TV_URL = `${base}/plextv`;
});
afterAll(() => pms.close());

beforeEach(async () => {
	db = testDb();
	await startLink(db, `${base}/plextv`, base);
	await fetch(`${base}/__fake/approve-pins`, { method: 'POST' });
	await pollLink(db, `${base}/plextv`);
	const user = insertUser(db, { plexHomeUserUuid: pms.ownerUuid });
	plex = plexFor(
		db,
		db
			.select()
			.from(users)
			.all()
			.find((u) => u.id === user.id)!
	);
});

describe('libraries', () => {
	it('lists only movie and show libraries', async () => {
		expect(await libraries(plex)).toEqual([
			{ id: '1', type: 'movie', title: 'Films' },
			{ id: '2', type: 'show', title: 'Tv-series' }
		]);
	});

	it('drops music, photo and hidden libraries', async () => {
		const stub = {
			json: async () => ({
				MediaContainer: {
					Directory: [
						{ key: '1', type: 'movie', title: 'Movies' },
						{ key: '2', type: 'show', title: 'TV' },
						{ key: '3', type: 'artist', title: 'Music' },
						{ key: '4', type: 'photo', title: 'Photos' },
						{ key: '5', type: 'movie', title: 'Hidden', hidden: 1 }
					]
				}
			})
		} as unknown as PlexSession;
		expect((await libraries(stub)).map((l) => l.title)).toEqual(['Movies', 'TV']);
	});
});

describe('discover', () => {
	it('builds Continue Watching, Next Up, Recently Added and recommendations', async () => {
		const d = await discover(plex);
		expect(d.continueWatching?.items.every((i) => i.viewOffset)).toBe(true);
		expect(d.continueWatching?.items[0].grandparentTitle).toBe('American Dad!');

		const inProgress = new Set(d.continueWatching!.items.map((i) => i.id));
		expect(d.nextUp?.title).toBe('Next Up');
		expect(d.nextUp?.items.length).toBeGreaterThan(0);
		expect(d.nextUp?.items.some((i) => inProgress.has(i.id))).toBe(false);
		expect(d.nextUp?.items.map((i) => i.grandparentTitle)).toContain('Futurama');

		expect(d.recentlyAdded.map((h) => h.title)).toEqual([
			'Recently Added Movies',
			'Recently Added TV'
		]);
		expect(d.recommended.map((h) => h.title)).toEqual(['Oh, The Horror!']);
		expect(d.featured?.id).toBe(d.continueWatching?.items.find((i) => i.art)?.id);
	});

	it('serves artwork through signed app URLs', async () => {
		const d = await discover(plex);
		for (const item of d.recentlyAdded[0].items) {
			expect(item.thumb).toMatch(/^\/img\//);
		}
	});
});
