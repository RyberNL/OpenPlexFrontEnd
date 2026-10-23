import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyPassword } from '../auth/password';
import { createSession, validateSession } from '../auth/session';
import { decrypt, encrypt, keyring, keyVersion, singleKeyring } from '../crypto';
import { contexts } from '../crypto-contexts';
import { openDatabase, type DB } from '../db';
import { plexLink, totpAuthenticators, users } from '../db/schema';
import { insertUser } from '../test-utils';
import { CliError, createAdmin, resetMfaCommand, rotateKey } from './commands';

let dir: string;
let db: DB;
const lines: string[] = [];
const out = (line: string) => lines.push(line);

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plex-client-cli-'));
	db = openDatabase(path.join(dir, 'app.db'));
	lines.length = 0;
});

afterEach(() => {
	db.$client.close();
	fs.rmSync(dir, { recursive: true, force: true });
});

describe('create-admin', () => {
	it('creates an admin with a printed temporary password that must be changed', async () => {
		const { user, password } = await createAdmin(db, 'rescue', out, 'Rescue Admin');
		expect(user).toMatchObject({
			role: 'admin',
			mustChangePassword: true,
			displayName: 'Rescue Admin'
		});
		expect(await verifyPassword(user.passwordHash, password)).toBe(true);
		expect(lines.join('\n')).toContain(`Temporary password: ${password}`);
	});

	it('refuses a taken username', async () => {
		insertUser(db, { username: 'rescue' });
		await expect(createAdmin(db, 'Rescue', out)).rejects.toThrow('That username is already taken.');
	});
});

describe('reset-mfa', () => {
	it('removes factors and sessions of the named user', () => {
		const anna = insertUser(db, { username: 'anna' });
		db.insert(totpAuthenticators)
			.values({ id: randomUUID(), userId: anna.id, name: 'Phone', secretEnc: 'x' })
			.run();
		const { token } = createSession(db, anna.id, 'full');
		resetMfaCommand(db, 'ANNA', out);
		expect(db.select().from(totpAuthenticators).all()).toHaveLength(0);
		expect(validateSession(db, token)).toBeNull();
	});

	it('reports an unknown user', () => {
		expect(() => resetMfaCommand(db, 'nobody', out)).toThrow(CliError);
	});
});

describe('rotate-key', () => {
	const oldKey = randomBytes(32);
	const newKey = randomBytes(32);

	function seed() {
		const anna = insertUser(db, { username: 'anna' });
		const totpId = randomUUID();
		db.insert(totpAuthenticators)
			.values({
				id: totpId,
				userId: anna.id,
				name: 'Phone',
				secretEnc: encrypt('JBSWY3DPEHPK3PXP', contexts.totpSecret(anna.id), keyring(oldKey))
			})
			.run();
		db.insert(plexLink)
			.values({
				id: 1,
				serverUrl: 'http://pms',
				machineIdentifier: 'm',
				serverName: 'PMS',
				serverVersion: '1',
				ownerTokenEnc: encrypt('owner-token', contexts.plexOwnerToken(), keyring(oldKey)),
				ownerServerTokenEnc: encrypt(
					'owner-server-token',
					contexts.plexOwnerServerToken(),
					keyring(oldKey)
				),
				clientIdentifier: 'client'
			})
			.run();
		return { anna, totpId };
	}

	it('re-encrypts every secret so the new key decrypts it', () => {
		seed();
		expect(rotateKey(db, oldKey, newKey, out)).toBe(3);
		const [totp] = db.select().from(totpAuthenticators).all();
		const link = db.select().from(plexLink).get()!;
		const ring = singleKeyring(newKey);
		expect(keyVersion(totp.secretEnc)).toBe(2);
		expect(decrypt(totp.secretEnc, contexts.totpSecret(totp.userId), ring)).toBe(
			'JBSWY3DPEHPK3PXP'
		);
		expect(decrypt(link.ownerTokenEnc, contexts.plexOwnerToken(), ring)).toBe('owner-token');
		expect(decrypt(link.ownerServerTokenEnc, contexts.plexOwnerServerToken(), ring)).toBe(
			'owner-server-token'
		);
	});

	it('changes nothing when the old key is wrong', () => {
		seed();
		const before = db.select().from(totpAuthenticators).all();
		expect(() => rotateKey(db, randomBytes(32), newKey, out)).toThrow(/Rotation aborted/);
		expect(db.select().from(totpAuthenticators).all()).toEqual(before);
	});

	it('can rotate again later', () => {
		seed();
		rotateKey(db, oldKey, newKey, out);
		const third = randomBytes(32);
		rotateKey(db, newKey, third, out);
		const [totp] = db.select().from(totpAuthenticators).all();
		expect(keyVersion(totp.secretEnc)).toBe(3);
		expect(decrypt(totp.secretEnc, contexts.totpSecret(totp.userId), singleKeyring(third))).toBe(
			'JBSWY3DPEHPK3PXP'
		);
	});

	it('rejects identical or malformed keys', () => {
		expect(() => rotateKey(db, newKey, newKey, out)).toThrow(/same/);
		expect(() => rotateKey(db, Buffer.alloc(8), newKey, out)).toThrow(/32 bytes/);
	});

	it('leaves users untouched', () => {
		const { anna } = seed();
		rotateKey(db, oldKey, newKey, out);
		expect(
			db
				.select()
				.from(users)
				.all()
				.map((u) => u.id)
		).toEqual([anna.id]);
	});
});
