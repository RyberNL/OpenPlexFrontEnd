import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '../db';
import { recoveryCodes } from '../db/schema';
import { insertUser, testDb } from '../test-utils';
import {
	generateRecoveryCodes,
	initialRecoveryCodes,
	remainingRecoveryCodes,
	useRecoveryCode
} from './recovery';

let db: DB;
let userId: string;

beforeEach(() => {
	db = testDb();
	userId = insertUser(db).id;
});

describe('recovery codes', () => {
	it('generates 10 distinct codes in XXXXX-XXXXX form, stored only as hashes', () => {
		const codes = generateRecoveryCodes(db, userId);
		expect(codes).toHaveLength(10);
		expect(new Set(codes).size).toBe(10);
		for (const code of codes) expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
		const stored = JSON.stringify(db.select().from(recoveryCodes).all());
		for (const code of codes) expect(stored).not.toContain(code.replace('-', ''));
	});

	it('accepts each code exactly once', () => {
		const [code] = generateRecoveryCodes(db, userId);
		expect(useRecoveryCode(db, userId, code)).toBe(true);
		expect(useRecoveryCode(db, userId, code)).toBe(false);
		expect(remainingRecoveryCodes(db, userId)).toBe(9);
	});

	it('ignores case and separators', () => {
		const [code] = generateRecoveryCodes(db, userId);
		expect(useRecoveryCode(db, userId, ` ${code.toLowerCase().replace('-', ' ')} `)).toBe(true);
	});

	it("rejects another user's code", () => {
		const [code] = generateRecoveryCodes(db, userId);
		const other = insertUser(db).id;
		generateRecoveryCodes(db, other);
		expect(useRecoveryCode(db, other, code)).toBe(false);
	});

	it('invalidates every earlier code when regenerated', () => {
		const old = generateRecoveryCodes(db, userId);
		const fresh = generateRecoveryCodes(db, userId);
		for (const code of old) expect(useRecoveryCode(db, userId, code)).toBe(false);
		expect(useRecoveryCode(db, userId, fresh[0])).toBe(true);
	});

	it('generates initial codes only once', () => {
		expect(initialRecoveryCodes(db, userId)).toHaveLength(10);
		expect(initialRecoveryCodes(db, userId)).toBeNull();
	});
});
