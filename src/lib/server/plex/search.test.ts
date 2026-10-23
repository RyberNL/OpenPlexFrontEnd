import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakePms } from '../../../../test/fake-pms/server';
import { users } from '../db/schema';
import { insertUser, testDb } from '../test-utils';
import { liveTv, search } from './api';
import { pollLink, startLink } from './link';
import { plexFor, type PlexSession } from './session';

const pms = createFakePms();
let plex: PlexSession;

beforeAll(async () => {
	process.env.PUBLIC_ORIGIN = 'https://plex.example.com';
	process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
	const base = `http://127.0.0.1:${await pms.listen()}`;
	process.env.PLEX_TV_URL = `${base}/plextv`;
	const db = testDb();
	await startLink(db, `${base}/plextv`, base);
	await fetch(`${base}/__fake/approve-pins`, { method: 'POST' });
	await pollLink(db, `${base}/plextv`);
	insertUser(db, { plexHomeUserUuid: pms.ownerUuid });
	plex = plexFor(db, db.select().from(users).all()[0]);
});
afterAll(() => pms.close());

describe('search', () => {
	it('finds the DVR and its guide', async () => {
		expect(await liveTv(plex)).toEqual({ dvrId: '4', epg: 'tv.plex.providers.epg.xmltv:4' });
	});

	it('groups movies, collections and people', async () => {
		const results = await search(plex, 'fast');
		expect(results.movies.map((m) => m.title)).toContain('2 Fast 2 Furious');
		expect(results.collections.map((c) => c.title)).toEqual(['Fast & Furious']);
		expect((await search(plex, 'theresa')).people).toEqual([
			expect.objectContaining({ id: '7147', name: 'Theresa Randle' })
		]);
	});

	it('includes upcoming Live TV programs with channel and times', async () => {
		const { programs } = await search(plex, 'nieuws');
		expect(programs.length).toBeGreaterThan(0);
		expect(programs[0]).toMatchObject({ title: expect.stringMatching(/nieuws/i) });
		expect(programs[0].channel).toBeTruthy();
		expect(programs[0].beginsAt).toBeGreaterThan(Date.now());
		expect(programs.every((p, i) => i === 0 || programs[i - 1].beginsAt <= p.beginsAt)).toBe(true);
	});

	it('returns nothing for very short queries', async () => {
		const results = await search(plex, 'a');
		expect(Object.values(results).every((list) => list.length === 0)).toBe(true);
	});
});

describe('search programs', () => {
	it('lists each airing once', async () => {
		const { programs } = await search(plex, 'nieuws');
		const keys = programs.map((p) => `${p.id}@${p.beginsAt}`);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
