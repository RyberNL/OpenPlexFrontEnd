import fs from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFakePms } from '../../../../test/fake-pms/server';
import { users } from '../db/schema';
import { insertUser, testDb } from '../test-utils';
import { children, itemDetails, setWatched } from './api';
import { pollLink, startLink } from './link';
import { plexFor, type PlexSession } from './session';

const pms = createFakePms();
let plex: PlexSession;
let otherPlex: PlexSession;
const seasonEpisodes: { ratingKey: string }[] = JSON.parse(
	fs.readFileSync('test/fixtures/plex/season-episodes.json', 'utf8')
).MediaContainer.Metadata;

beforeAll(async () => {
	process.env.PUBLIC_ORIGIN = 'https://plex.example.com';
	process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
	const base = `http://127.0.0.1:${await pms.listen()}`;
	process.env.PLEX_TV_URL = `${base}/plextv`;
	const db = testDb();
	await startLink(db, `${base}/plextv`, base);
	await fetch(`${base}/__fake/approve-pins`, { method: 'POST' });
	await pollLink(db, `${base}/plextv`);
	const owner = insertUser(db, { plexHomeUserUuid: pms.ownerUuid });
	const { mapUser } = await import('./home');
	const ben = insertUser(db);
	await mapUser(db, ben.id, 'home-ben');
	const rows = db.select().from(users).all();
	plex = plexFor(
		db,
		rows.find((u) => u.id === owner.id)!
	);
	otherPlex = plexFor(
		db,
		rows.find((u) => u.id === ben.id)!
	);
});
afterAll(() => pms.close());
beforeEach(() => {
	pms.state.watched.clear();
});

describe('mark watched / unwatched', () => {
	it('marking a season watched marks every episode in it', async () => {
		await setWatched(plex, '12498', true);
		const episodes = await children(plex, '12498');
		expect(episodes).toHaveLength(seasonEpisodes.length);
		expect(episodes.every((e) => e.watched)).toBe(true);
	});

	it('marking a season unwatched clears every episode', async () => {
		await setWatched(plex, '12498', false);
		expect((await children(plex, '12498')).some((e) => e.watched)).toBe(false);
	});

	it('marks a single movie for this Plex identity only', async () => {
		await setWatched(plex, '157', true);
		expect((await itemDetails(plex, '157'))?.watched).toBe(true);
		expect((await itemDetails(otherPlex, '157'))?.watched).toBe(false);
		await setWatched(plex, '157', false);
		expect((await itemDetails(plex, '157'))?.watched).toBe(false);
	});

	it('sends a scrobble for the item to PMS', async () => {
		await setWatched(plex, '12497', true);
		expect(pms.state.requests.at(-1)).toMatchObject({
			path: '/:/scrobble',
			query: { key: '12497', identifier: 'com.plexapp.plugins.library' }
		});
	});
});
