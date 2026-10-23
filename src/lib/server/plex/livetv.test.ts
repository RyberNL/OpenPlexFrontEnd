import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakePms } from '../../../../test/fake-pms/server';
import { users } from '../db/schema';
import { insertUser, testDb } from '../test-utils';
import { liveTv } from './api';
import { pollLink, startLink } from './link';
import { airingNow, channels, groupByCategory, guide, toAirings, type Dvr } from './livetv';
import { plexFor, type PlexSession } from './session';

const pms = createFakePms();
let plex: PlexSession;
let dvr: Dvr;

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
	dvr = (await liveTv(plex))!;
});
afterAll(() => pms.close());

describe('Live TV', () => {
	it('lists the lineup with numbers, names and relayed logos', async () => {
		const list = await channels(plex, dvr);
		expect(list).toHaveLength(18);
		expect(list[2]).toMatchObject({ id: '1032', number: '1032' });
		expect(list[2].title).toContain('NPO 1 HD');
		// Logos go through the app's image relay, never straight to the logo CDN.
		expect(list[2].logo).toMatch(/^\/img\//);
	});

	it('reads the guide as airings within the window, and what is on now', async () => {
		const now = Date.now();
		const airings = await guide(plex, dvr, now, now + 3 * 3600_000);
		expect(airings.length).toBeGreaterThan(30);
		for (const a of airings) {
			expect(a.endsAt).toBeGreaterThan(now);
			expect(a.beginsAt).toBeLessThan(now + 3 * 3600_000);
		}
		expect(new Set(airings.map((a) => a.id)).size).toBe(airings.length);
		expect(airingNow(airings, now).size).toBeGreaterThan(10);
	});

	it('covers a full day ahead', async () => {
		const later = Date.now() + 20 * 3600_000;
		expect((await guide(plex, dvr, later, later + 3600_000)).length).toBeGreaterThan(10);
	});

	it('splits programs into airings and drops duplicates', () => {
		const media = (channel: string, at: number) => ({
			id: 1,
			channelIdentifier: channel,
			beginsAt: at,
			endsAt: at + 1800
		});
		const airings = toAirings(
			[
				{
					ratingKey: 'p1',
					type: 'episode',
					title: 'Pilot',
					grandparentTitle: 'The Show',
					parentIndex: 1,
					index: 2,
					Media: [media('1', 1000), media('2', 5000), media('1', 1000)]
				}
			] as never,
			0,
			10_000_000
		);
		expect(airings).toHaveLength(2);
		expect(airings[0]).toMatchObject({
			id: '1@1000',
			title: 'The Show',
			subtitle: 'Pilot',
			season: 1,
			episode: 2,
			beginsAt: 1_000_000,
			endsAt: 2_800_000
		});
	});

	it('groups by the guide categories, or not at all when the guide has none', () => {
		const airing = (id: string, category?: string) =>
			({ id, category }) as Parameters<typeof groupByCategory>[0][number];
		expect(groupByCategory([])).toEqual([]);
		expect(groupByCategory([airing('a'), airing('b')])).toEqual([
			{ name: null, airings: [airing('a'), airing('b')] }
		]);
		expect(
			groupByCategory([airing('a', 'Sports'), airing('b'), airing('c', 'News')]).map((g) => [
				g.name,
				g.airings.map((x) => x.id)
			])
		).toEqual([
			['News', ['c']],
			['Sports', ['a']],
			['Other', ['b']]
		]);
	});
});
