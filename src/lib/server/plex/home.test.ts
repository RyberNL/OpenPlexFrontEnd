import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFakePms } from '../../../../test/fake-pms/server';
import type { DB } from '../db';
import { plexHomeTokens, users } from '../db/schema';
import { insertUser, testDb } from '../test-utils';
import { HomeUserError, listHomeUsers, mapUser } from './home';
import { pollLink, startLink } from './link';
import { containerSchema, sectionsSchema } from './schemas';
import { NotLinkedError, plexFor } from './session';

const pms = createFakePms();
let base: string;
let plexTv: string;
let db: DB;

beforeAll(async () => {
	process.env.PUBLIC_ORIGIN = 'https://plex.example.com';
	process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
	base = `http://127.0.0.1:${await pms.listen()}`;
	plexTv = `${base}/plextv`;
	process.env.PLEX_TV_URL = plexTv;
});
afterAll(() => pms.close());

beforeEach(async () => {
	await fetch(`${base}/__fake/reset`, { method: 'POST' });
	db = testDb();
	await startLink(db, plexTv, base);
	await fetch(`${base}/__fake/approve-pins`, { method: 'POST' });
	await pollLink(db, plexTv);
});

const userRow = (id: string) => db.select().from(users).where(eq(users.id, id)).get()!;
const tokensUsed = () =>
	pms.state.requests.filter((r) => !r.path.startsWith('/plextv')).map((r) => r.token);

/** The account owner's name in the recorded fixtures (recorded from your own Plex server). */
const OWNER = JSON.parse(fs.readFileSync('test/fixtures/plex/plextv-home-users.json', 'utf8'))
	.users[0].title as string;

describe('Plex Home users', () => {
	it('lists the owner and managed users of the linked account', async () => {
		const home = await listHomeUsers(db, plexTv);
		expect(home.map((u) => [u.title, u.admin, u.protected])).toEqual([
			[OWNER, true, false],
			['Anna', false, true],
			['Ben', false, false]
		]);
	});

	it('acts as the owner when mapped to the owner', async () => {
		const user = insertUser(db);
		await mapUser(db, user.id, pms.ownerUuid, null, plexTv);
		expect(userRow(user.id).plexHomeUserTitle).toBe(OWNER);
		await plexFor(db, userRow(user.id)).json('/library/sections', sectionsSchema);
		expect(tokensUsed().at(-1)).toBe('owner-token');
	});

	it('requires the PIN of a protected Home user', async () => {
		const user = insertUser(db);
		await expect(mapUser(db, user.id, 'home-anna', null, plexTv)).rejects.toThrow(
			new HomeUserError('This Plex Home user needs their PIN.')
		);
		await expect(mapUser(db, user.id, 'home-anna', '0000', plexTv)).rejects.toThrow(
			'That Plex Home PIN is not correct.'
		);
		expect(userRow(user.id).plexHomeUserUuid).toBeNull();
		await mapUser(db, user.id, 'home-anna', '1234', plexTv);
		expect(userRow(user.id).plexHomeUserUuid).toBe('home-anna');
	});

	it('caches each Home user token encrypted and uses it for requests', async () => {
		const user = insertUser(db);
		await mapUser(db, user.id, 'home-ben', null, plexTv);
		await plexFor(db, userRow(user.id)).json('/library/sections', sectionsSchema);
		expect(tokensUsed().at(-1)).toMatch(/^home-token-home-ben\.\d+$/);
		const stored = JSON.stringify(db.select().from(plexHomeTokens).all());
		expect(stored).not.toContain('home-token');
	});

	it('keeps watch state per Plex identity', async () => {
		const anna = insertUser(db);
		const ben = insertUser(db);
		await mapUser(db, anna.id, 'home-anna', '1234', plexTv);
		await mapUser(db, ben.id, 'home-ben', null, plexTv);
		const annaPlex = plexFor(db, userRow(anna.id));
		const benPlex = plexFor(db, userRow(ben.id));

		const listing = async (session: typeof annaPlex) =>
			(
				await session.json('/library/sections/1/all', containerSchema, {
					query: { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 30, sort: 'titleSort' }
				})
			).MediaContainer.Metadata!;
		const unwatched = (await listing(benPlex)).find((m) => !m.viewCount && !m.viewOffset)!;
		expect(unwatched).toBeTruthy();

		await annaPlex.fetch('/:/scrobble', {
			query: { key: unwatched.ratingKey, identifier: 'com.plexapp.plugins.library' }
		});
		const viewCount = async (session: typeof annaPlex) =>
			(await listing(session)).find((m) => m.ratingKey === unwatched.ratingKey)!.viewCount ?? 0;
		expect(await viewCount(annaPlex)).toBeGreaterThan(0);
		expect(await viewCount(benPlex)).toBe(0);
	});

	it('refreshes an expired Home user token and retries once', async () => {
		const user = insertUser(db);
		await mapUser(db, user.id, 'home-ben', null, plexTv);
		const session = plexFor(db, userRow(user.id));
		const oldToken = await session.token();
		await fetch(`${base}/__fake/revoke-token?token=${encodeURIComponent(oldToken)}`, {
			method: 'POST'
		});

		const result = await session.json('/library/sections', sectionsSchema);
		expect(result.MediaContainer.Directory?.length).toBeGreaterThan(0);
		const pmsTokens = tokensUsed().slice(-2);
		expect(pmsTokens[0]).toBe(oldToken);
		expect(pmsTokens[1]).not.toBe(oldToken);
		expect(await session.token()).toBe(pmsTokens[1]);
	});

	it('reports unmapped users', () => {
		const user = insertUser(db);
		expect(() => plexFor(db, userRow(user.id))).toThrow(new NotLinkedError('user'));
	});

	it('clears a mapping', async () => {
		const user = insertUser(db);
		await mapUser(db, user.id, 'home-ben', null, plexTv);
		await mapUser(db, user.id, null);
		expect(userRow(user.id).plexHomeUserUuid).toBeNull();
	});
});
