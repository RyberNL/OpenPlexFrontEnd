import { randomBytes, randomUUID } from 'node:crypto';
import { count, eq, sql } from 'drizzle-orm';
import type { DB } from '../db';
import { totpAuthenticators, users, webauthnCredentials } from '../db/schema';
import { hashPassword, passwordPolicyError } from './password';
import type { SessionLevel, User } from './session';

const USERNAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/;

export class AccountError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AccountError';
	}
}

/** Returns a user-facing problem with the username, or null when valid. */
export function usernameError(username: string): string | null {
	if (!USERNAME_PATTERN.test(username)) {
		return 'Username must be 3–32 characters: letters, digits, dot, dash or underscore, starting with a letter or digit.';
	}
	return null;
}

export function findUserByUsername(db: DB, username: string): User | undefined {
	return db
		.select()
		.from(users)
		.where(sql`${users.username} = ${username.trim()} COLLATE NOCASE`)
		.get();
}

export function findUserById(db: DB, id: string): User | undefined {
	return db.select().from(users).where(eq(users.id, id)).get();
}

export function countUsers(db: DB) {
	return db.select({ n: count() }).from(users).get()!.n;
}

export type NewUser = {
	username: string;
	displayName: string;
	role: 'admin' | 'user';
	password: string;
	mustChangePassword?: boolean;
};

/** Validates and creates an account. Throws {@link AccountError} with a user-facing message. */
export async function createUser(db: DB, input: NewUser): Promise<User> {
	const username = input.username.trim();
	const displayName = input.displayName.trim() || username;
	const problem = usernameError(username) ?? passwordPolicyError(input.password, username);
	if (problem) throw new AccountError(problem);
	if (displayName.length > 64)
		throw new AccountError('Display name must be at most 64 characters.');
	if (findUserByUsername(db, username)) throw new AccountError('That username is already taken.');

	const passwordHash = await hashPassword(input.password);
	try {
		return db
			.insert(users)
			.values({
				id: randomUUID(),
				username,
				displayName,
				role: input.role,
				passwordHash,
				mustChangePassword: input.mustChangePassword ?? false,
				webauthnUserId: randomBytes(32).toString('base64url'),
				updatedAt: Date.now()
			})
			.returning()
			.get();
	} catch (error) {
		// Lost a race with a concurrent insert of the same username.
		if (String(error).includes('UNIQUE')) throw new AccountError('That username is already taken.');
		throw error;
	}
}

export function hasSecondFactor(db: DB, userId: string) {
	const passkeys = db
		.select({ n: count() })
		.from(webauthnCredentials)
		.where(eq(webauthnCredentials.userId, userId))
		.get()!.n;
	if (passkeys > 0) return true;
	const totps = db
		.select({ n: count() })
		.from(totpAuthenticators)
		.where(eq(totpAuthenticators.userId, userId))
		.get()!.n;
	return totps > 0;
}

/** Session level a user reaches after a correct password. */
export function levelAfterPassword(db: DB, user: User): SessionLevel {
	if (user.mustChangePassword) return 'pending_password_change';
	return hasSecondFactor(db, user.id) ? 'pending_mfa' : 'pending_mfa_enroll';
}

export async function setPassword(db: DB, userId: string, password: string, mustChange = false) {
	db.update(users)
		.set({
			passwordHash: await hashPassword(password),
			mustChangePassword: mustChange,
			updatedAt: Date.now()
		})
		.where(eq(users.id, userId))
		.run();
}

/** Which kinds of second factor a user has enrolled. */
export function factorSummary(db: DB, userId: string) {
	const passkeys = db
		.select({ n: count() })
		.from(webauthnCredentials)
		.where(eq(webauthnCredentials.userId, userId))
		.get()!.n;
	const totps = db
		.select({ n: count() })
		.from(totpAuthenticators)
		.where(eq(totpAuthenticators.userId, userId))
		.get()!.n;
	return { passkeys, totps };
}
