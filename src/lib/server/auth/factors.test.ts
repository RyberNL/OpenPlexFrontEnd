import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '../db';
import { totpAuthenticators, webauthnCredentials } from '../db/schema';
import { insertUser, testDb } from '../test-utils';
import { FactorError, listFactors, removeFactor, renameFactor } from './factors';

let db: DB;
let userId: string;

beforeEach(() => {
	db = testDb();
	userId = insertUser(db).id;
});

function addPasskey(owner = userId, name = 'MacBook') {
	const id = randomUUID();
	db.insert(webauthnCredentials)
		.values({ id, userId: owner, publicKey: Buffer.from([1]), name, createdAt: 1 })
		.run();
	return id;
}

function addTotp(owner = userId, name = 'Phone') {
	const id = randomUUID();
	db.insert(totpAuthenticators)
		.values({ id, userId: owner, name, secretEnc: 'x', createdAt: 2 })
		.run();
	return id;
}

describe('factors', () => {
	it('lists passkeys and authenticators together, oldest first', () => {
		addTotp();
		addPasskey();
		expect(listFactors(db, userId).map((f) => [f.kind, f.name])).toEqual([
			['passkey', 'MacBook'],
			['totp', 'Phone']
		]);
	});

	it('renames a factor', () => {
		const id = addPasskey();
		expect(renameFactor(db, userId, 'passkey', id, '  Work laptop  ')).toBe('Work laptop');
		expect(listFactors(db, userId)[0].name).toBe('Work laptop');
	});

	it("cannot rename or remove another user's factor", () => {
		const other = insertUser(db).id;
		const id = addPasskey(other);
		addTotp(other);
		expect(() => renameFactor(db, userId, 'passkey', id, 'Mine now')).toThrow(FactorError);
		expect(() => removeFactor(db, userId, 'passkey', id)).toThrow(FactorError);
		expect(listFactors(db, other)).toHaveLength(2);
	});

	it('removes a factor while another remains', () => {
		const passkey = addPasskey();
		addTotp();
		removeFactor(db, userId, 'passkey', passkey);
		expect(listFactors(db, userId).map((f) => f.kind)).toEqual(['totp']);
	});

	it('refuses to remove the last factor', () => {
		const totp = addTotp();
		expect(() => removeFactor(db, userId, 'totp', totp)).toThrow(/only sign-in method/);
		expect(listFactors(db, userId)).toHaveLength(1);
	});
});
