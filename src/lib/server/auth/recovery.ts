import { createHash, randomInt, randomUUID } from 'node:crypto';
import { and, count, eq, isNull } from 'drizzle-orm';
import type { DB } from '../db';
import { recoveryCodes } from '../db/schema';

export const RECOVERY_CODE_COUNT = 10;
/** Crockford-style alphabet without easily confused characters (no I, L, O, U). */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Uppercases and strips separators so "abcde-12345" and "ABCDE 12345" match. */
export function normalizeRecoveryCode(code: string) {
	return code.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function hashCode(code: string) {
	return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

function newCode() {
	let raw = '';
	for (let i = 0; i < 10; i++) raw += ALPHABET[randomInt(ALPHABET.length)];
	return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/** Replaces the user's recovery codes with a fresh set and returns them (shown only once). */
export function generateRecoveryCodes(db: DB, userId: string, now = Date.now()) {
	const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newCode);
	db.transaction((tx) => {
		tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId)).run();
		tx.insert(recoveryCodes)
			.values(
				codes.map((code) => ({
					id: randomUUID(),
					userId,
					codeHash: hashCode(code),
					createdAt: now
				}))
			)
			.run();
	});
	return codes;
}

/** Whether a set was ever generated (even if every code has been used since). */
export function hasRecoveryCodes(db: DB, userId: string) {
	const { n } = db
		.select({ n: count() })
		.from(recoveryCodes)
		.where(eq(recoveryCodes.userId, userId))
		.get()!;
	return n > 0;
}

export function remainingRecoveryCodes(db: DB, userId: string) {
	return db
		.select({ n: count() })
		.from(recoveryCodes)
		.where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)))
		.get()!.n;
}

/** Consumes an unused recovery code; returns whether it was valid. */
export function useRecoveryCode(db: DB, userId: string, code: string, now = Date.now()) {
	if (normalizeRecoveryCode(code).length !== 10) return false;
	const result = db
		.update(recoveryCodes)
		.set({ usedAt: now })
		.where(
			and(
				eq(recoveryCodes.userId, userId),
				eq(recoveryCodes.codeHash, hashCode(code)),
				isNull(recoveryCodes.usedAt)
			)
		)
		.run();
	return result.changes === 1;
}

/** Generates codes on the user's first factor enrollment; returns them, or null if they exist. */
export function initialRecoveryCodes(db: DB, userId: string) {
	return hasRecoveryCodes(db, userId) ? null : generateRecoveryCodes(db, userId);
}
