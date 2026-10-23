import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSession, validateSession } from '../auth/session';
import type { DB } from '../db';
import { recoveryCodes, totpAuthenticators, users, webauthnCredentials } from '../db/schema';
import { insertUser, testDb } from '../test-utils';
import {
	AdminError,
	createUserAsAdmin,
	deleteUser,
	listUsers,
	resetMfa,
	setDisabled,
	updateUser
} from './users';

let db: DB;
let admin: { id: string };

beforeEach(() => {
	db = testDb();
	admin = insertUser(db, { username: 'root', role: 'admin' });
});

describe('admin user management', () => {
	it('creates users who must change their password', async () => {
		const anna = await createUserAsAdmin(db, {
			username: 'anna',
			displayName: 'Anna',
			role: 'user',
			password: 'initial password 1'
		});
		expect(anna.mustChangePassword).toBe(true);
		expect(listUsers(db).map((u) => u.username)).toEqual(['anna', 'root']);
	});

	it('disabling a user revokes their sessions; enabling does not restore them', () => {
		const anna = insertUser(db, { username: 'anna' });
		const { token } = createSession(db, anna.id, 'full');
		setDisabled(db, admin.id, anna.id, true);
		expect(validateSession(db, token)).toBeNull();
		setDisabled(db, admin.id, anna.id, false);
		expect(validateSession(db, token)).toBeNull();
		expect(listUsers(db).find((u) => u.id === anna.id)?.disabled).toBe(false);
	});

	it('deleting a user removes them and their sessions', () => {
		const anna = insertUser(db, { username: 'anna' });
		const { token } = createSession(db, anna.id, 'full');
		deleteUser(db, admin.id, anna.id);
		expect(validateSession(db, token)).toBeNull();
		expect(db.select().from(users).all()).toHaveLength(1);
	});

	it('refuses to disable, demote or delete your own account', () => {
		insertUser(db, { role: 'admin' });
		expect(() => setDisabled(db, admin.id, admin.id, true)).toThrow(/your own account/);
		expect(() => updateUser(db, admin.id, admin.id, { role: 'user' })).toThrow(/your own account/);
		expect(() => deleteUser(db, admin.id, admin.id)).toThrow(/your own account/);
	});

	it('refuses to leave no enabled administrator (e.g. from the CLI)', () => {
		expect(() => setDisabled(db, null, admin.id, true)).toThrow(AdminError);
		expect(() => updateUser(db, null, admin.id, { role: 'user' })).toThrow(/last enabled/);
		expect(() => deleteUser(db, null, admin.id)).toThrow(/last enabled/);
		const second = insertUser(db, { role: 'admin', disabled: true });
		expect(() => setDisabled(db, null, admin.id, true)).toThrow(/last enabled/);
		setDisabled(db, null, second.id, false);
		expect(() => setDisabled(db, null, admin.id, true)).not.toThrow();
	});

	it('lets an admin promote and demote other users', () => {
		const anna = insertUser(db);
		expect(updateUser(db, admin.id, anna.id, { role: 'admin' }).role).toBe('admin');
		expect(
			updateUser(db, admin.id, anna.id, { role: 'user', displayName: 'Anna B' })
		).toMatchObject({ role: 'user', displayName: 'Anna B' });
	});

	it('resets MFA: removes all factors and codes and signs the user out', () => {
		const anna = insertUser(db);
		db.insert(webauthnCredentials)
			.values({ id: 'cred', userId: anna.id, publicKey: Buffer.from([1]), name: 'Mac' })
			.run();
		db.insert(totpAuthenticators)
			.values({ id: randomUUID(), userId: anna.id, name: 'Phone', secretEnc: 'x' })
			.run();
		db.insert(recoveryCodes).values({ id: randomUUID(), userId: anna.id, codeHash: 'h' }).run();
		const { token } = createSession(db, anna.id, 'full');

		resetMfa(db, anna.id);
		expect(db.select().from(webauthnCredentials).all()).toHaveLength(0);
		expect(db.select().from(totpAuthenticators).all()).toHaveLength(0);
		expect(db.select().from(recoveryCodes).all()).toHaveLength(0);
		expect(validateSession(db, token)).toBeNull();
	});

	it('reports a missing user', () => {
		expect(() => setDisabled(db, admin.id, 'nope', true)).toThrow('That user no longer exists.');
	});
});
