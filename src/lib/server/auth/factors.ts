import { and, eq } from 'drizzle-orm';
import type { DB } from '../db';
import { totpAuthenticators, webauthnCredentials } from '../db/schema';

export type FactorKind = 'passkey' | 'totp';

export type Factor = {
	kind: FactorKind;
	id: string;
	name: string;
	createdAt: number;
	lastUsedAt: number | null;
};

export function listFactors(db: DB, userId: string): Factor[] {
	const passkeys = db
		.select()
		.from(webauthnCredentials)
		.where(eq(webauthnCredentials.userId, userId))
		.all()
		.map((c) => ({
			kind: 'passkey' as const,
			id: c.id,
			name: c.name,
			createdAt: c.createdAt,
			lastUsedAt: c.lastUsedAt
		}));
	const totps = db
		.select()
		.from(totpAuthenticators)
		.where(eq(totpAuthenticators.userId, userId))
		.all()
		.map((t) => ({
			kind: 'totp' as const,
			id: t.id,
			name: t.name,
			createdAt: t.createdAt,
			lastUsedAt: t.lastUsedAt
		}));
	return [...passkeys, ...totps].sort((a, b) => a.createdAt - b.createdAt);
}

function table(kind: FactorKind) {
	return kind === 'passkey' ? webauthnCredentials : totpAuthenticators;
}

export class FactorError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FactorError';
	}
}

export function renameFactor(db: DB, userId: string, kind: FactorKind, id: string, name: string) {
	const trimmed = name.trim().slice(0, 64);
	if (!trimmed) throw new FactorError('Enter a name.');
	const t = table(kind);
	const result = db
		.update(t)
		.set({ name: trimmed })
		.where(and(eq(t.id, id), eq(t.userId, userId)))
		.run();
	if (result.changes === 0) throw new FactorError('That sign-in method no longer exists.');
	return trimmed;
}

/** Removes a factor; refuses to remove the user's last remaining one. */
export function removeFactor(db: DB, userId: string, kind: FactorKind, id: string) {
	return db.transaction((tx) => {
		const factors = listFactors(tx as unknown as DB, userId);
		const factor = factors.find((f) => f.kind === kind && f.id === id);
		if (!factor) throw new FactorError('That sign-in method no longer exists.');
		if (factors.length === 1) {
			throw new FactorError(
				'You can’t remove your only sign-in method. Add another passkey or authenticator first.'
			);
		}
		const t = table(kind);
		tx.delete(t)
			.where(and(eq(t.id, id), eq(t.userId, userId)))
			.run();
		return factor;
	});
}
