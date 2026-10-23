import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFakePms } from '../../../../test/fake-pms/server';
import type { DB } from '../db';
import { appSettings, plexLink } from '../db/schema';
import { testDb } from '../test-utils';
import {
	clientIdentifier,
	LinkError,
	linkedServer,
	ownerAccountToken,
	ownerServerToken,
	pollLink,
	serverStatus,
	startLink
} from './link';

const pms = createFakePms();
let base: string;
let plexTv: string;
let db: DB;

beforeAll(async () => {
	process.env.PUBLIC_ORIGIN = 'https://plex.example.com';
	process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
	base = `http://127.0.0.1:${await pms.listen()}`;
	plexTv = `${base}/plextv`;
});
afterAll(() => pms.close());
beforeEach(async () => {
	db = testDb();
	await fetch(`${base}/__fake/reset`, { method: 'POST' });
});

describe('linking a Plex server', () => {
	it('links after the owner approves the PIN', async () => {
		const pending = await startLink(db, plexTv, `${base}/`);
		expect(pending.code).toMatch(/^\w{4}$/);
		expect(pending.serverUrl).toBe(base);
		expect(await pollLink(db, plexTv)).toEqual({
			status: 'pending',
			code: pending.code,
			expiresAt: pending.expiresAt
		});

		await fetch(`${base}/__fake/approve-pins`, { method: 'POST' });
		const result = await pollLink(db, plexTv);
		expect(result.status).toBe('linked');

		expect(linkedServer(db)).toMatchObject({
			serverUrl: base,
			machineIdentifier: pms.machineIdentifier,
			serverVersion: '1.43.5.11029-6bf8af3f0',
			ownerUuid: pms.ownerUuid,
			clientIdentifier: clientIdentifier(db)
		});
		expect(ownerServerToken(db)).toBe('owner-token');
		expect(ownerAccountToken(db)).toBe('owner-account-token');
		const stored = JSON.stringify(db.select().from(plexLink).all());
		expect(stored).not.toContain('owner-token');
		expect(stored).not.toContain('owner-account-token');
		expect(await pollLink(db, plexTv)).toEqual({ status: 'idle' });
	});

	it('identifies itself with a stable client identifier', async () => {
		await startLink(db, plexTv, base);
		const ids = new Set(
			pms.state.requests.map((r) => r.headers['x-plex-client-identifier']).filter(Boolean)
		);
		expect([...ids]).toEqual([clientIdentifier(db)]);
	});

	it('fails with a message naming an unreachable server', async () => {
		await expect(startLink(db, plexTv, 'http://127.0.0.1:9')).rejects.toThrow(
			new LinkError(
				'Could not reach http://127.0.0.1:9. Check the address and that Plex is running.'
			)
		);
	});

	it('rejects a malformed address', async () => {
		await expect(startLink(db, plexTv, 'not a url')).rejects.toThrow(/http:\/\/host:32400/);
	});

	it('refuses when the approving account does not own the server', async () => {
		await startLink(db, plexTv, base);
		const row = db
			.select()
			.from(appSettings)
			.where(eq(appSettings.key, 'plex_pending_link'))
			.get()!;
		const pending = JSON.parse(row.value);
		db.update(appSettings)
			.set({ value: JSON.stringify({ ...pending, machineIdentifier: 'someone-elses-server' }) })
			.where(eq(appSettings.key, 'plex_pending_link'))
			.run();
		await fetch(`${base}/__fake/approve-pins`, { method: 'POST' });
		await expect(pollLink(db, plexTv)).rejects.toThrow(/does not own the server/);
		expect(linkedServer(db)).toBeNull();
	});

	it('reports whether the linked server is reachable', async () => {
		await startLink(db, plexTv, base);
		await fetch(`${base}/__fake/approve-pins`, { method: 'POST' });
		await pollLink(db, plexTv);
		expect((await serverStatus(db))?.connected).toBe(true);
		pms.state.online = false;
		try {
			expect((await serverStatus(db))?.connected).toBe(false);
		} finally {
			pms.state.online = true;
		}
	});
});
