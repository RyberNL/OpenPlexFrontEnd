import { describe, expect, it } from 'vitest';
import { hashPassword, passwordPolicyError, verifyPassword } from './password';

describe('password hashing', () => {
	it('stores an argon2id hash, never the password', async () => {
		const stored = await hashPassword('correct horse battery');
		expect(stored).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
		expect(stored).not.toContain('correct horse battery');
	});

	it('uses a unique salt per hash', async () => {
		expect(await hashPassword('same password!')).not.toBe(await hashPassword('same password!'));
	});

	it('verifies the right password and rejects a wrong one', async () => {
		const stored = await hashPassword('correct horse battery');
		expect(await verifyPassword(stored, 'correct horse battery')).toBe(true);
		expect(await verifyPassword(stored, 'Correct horse battery')).toBe(false);
	});

	it('returns false for unknown users after doing comparable work', async () => {
		const stored = await hashPassword('correct horse battery');
		const time = async (fn: () => Promise<unknown>) => {
			const start = performance.now();
			await fn();
			return performance.now() - start;
		};
		await verifyPassword(null, 'warm up the dummy hash');
		const known = await time(() => verifyPassword(stored, 'wrong password!!'));
		const unknown = await time(() => verifyPassword(null, 'wrong password!!'));
		expect(await verifyPassword(null, 'anything')).toBe(false);
		// Both paths run a full argon2 verification; allow generous jitter.
		expect(unknown).toBeGreaterThan(known * 0.3);
	});

	it('treats a corrupt stored hash as a mismatch', async () => {
		expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false);
	});
});

describe('passwordPolicyError', () => {
	it('rejects passwords shorter than 12 characters', () => {
		expect(passwordPolicyError('short123', 'anna')).toBe(
			'Password must be at least 12 characters long.'
		);
	});

	it('accepts exactly 12 and up to 128 characters', () => {
		expect(passwordPolicyError('a'.repeat(12), 'anna')).toBeNull();
		expect(passwordPolicyError('a'.repeat(128), 'anna')).toBeNull();
	});

	it('rejects passwords longer than 128 characters', () => {
		expect(passwordPolicyError('a'.repeat(129), 'anna')).toBe(
			'Password must be at most 128 characters long.'
		);
	});

	it('counts characters, not UTF-16 code units', () => {
		expect(passwordPolicyError('🔒'.repeat(11), 'anna')).toMatch(/at least 12/);
	});

	it('rejects a password equal to the username, ignoring case', () => {
		expect(passwordPolicyError('LongUsername123', 'longusername123')).toBe(
			'Password must not be the same as the username.'
		);
	});
});
