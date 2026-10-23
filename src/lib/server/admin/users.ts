import { and, count, eq, max, ne } from 'drizzle-orm';
import { createUser, findUserById, type NewUser } from '../auth/accounts';
import { revokeUserSessions } from '../auth/session';
import type { DB } from '../db';
import {
	authChallenges,
	loginAttempts,
	recoveryCodes,
	sessions,
	totpAuthenticators,
	users,
	webauthnCredentials
} from '../db/schema';

export class AdminError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AdminError';
	}
}

export type UserRow = {
	id: string;
	username: string;
	displayName: string;
	role: 'admin' | 'user';
	disabled: boolean;
	mustChangePassword: boolean;
	plexHomeUserUuid: string | null;
	plexHomeUserTitle: string | null;
	passkeys: number;
	totps: number;
	lastSeenAt: number | null;
	createdAt: number;
};

export function listUsers(db: DB): UserRow[] {
	const passkeys = new Map(
		db
			.select({ userId: webauthnCredentials.userId, n: count() })
			.from(webauthnCredentials)
			.groupBy(webauthnCredentials.userId)
			.all()
			.map((r) => [r.userId, r.n])
	);
	const totps = new Map(
		db
			.select({ userId: totpAuthenticators.userId, n: count() })
			.from(totpAuthenticators)
			.groupBy(totpAuthenticators.userId)
			.all()
			.map((r) => [r.userId, r.n])
	);
	const lastSeen = new Map(
		db
			.select({ userId: sessions.userId, at: max(sessions.lastSeenAt) })
			.from(sessions)
			.groupBy(sessions.userId)
			.all()
			.map((r) => [r.userId, r.at])
	);
	return db
		.select()
		.from(users)
		.orderBy(users.username)
		.all()
		.map((u) => ({
			id: u.id,
			username: u.username,
			displayName: u.displayName,
			role: u.role,
			disabled: u.disabled,
			mustChangePassword: u.mustChangePassword,
			plexHomeUserUuid: u.plexHomeUserUuid,
			plexHomeUserTitle: u.plexHomeUserTitle,
			passkeys: passkeys.get(u.id) ?? 0,
			totps: totps.get(u.id) ?? 0,
			lastSeenAt: lastSeen.get(u.id) ?? null,
			createdAt: u.createdAt
		}));
}

function enabledAdminsExcept(db: DB, userId: string) {
	return db
		.select({ n: count() })
		.from(users)
		.where(and(eq(users.role, 'admin'), eq(users.disabled, false), ne(users.id, userId)))
		.get()!.n;
}

function target(db: DB, userId: string) {
	const user = findUserById(db, userId);
	if (!user) throw new AdminError('That user no longer exists.');
	return user;
}

/**
 * Refuses changes that would lock administrators out: acting on one's own account, or leaving no
 * enabled administrator.
 */
function guardAdmins(db: DB, actorId: string | null, userId: string, what: string) {
	if (actorId === userId) throw new AdminError(`You can’t ${what} your own account.`);
	const user = target(db, userId);
	if (user.role === 'admin' && !user.disabled && enabledAdminsExcept(db, userId) === 0) {
		throw new AdminError(`You can’t ${what} the last enabled administrator.`);
	}
	return user;
}

/** Creates a user who must choose a new password and set up two-factor at first sign-in. */
export function createUserAsAdmin(db: DB, input: Omit<NewUser, 'mustChangePassword'>) {
	return createUser(db, { ...input, mustChangePassword: true });
}

export function updateUser(
	db: DB,
	actorId: string | null,
	userId: string,
	changes: { displayName?: string; role?: 'admin' | 'user' }
) {
	const user = target(db, userId);
	if (changes.role && changes.role !== user.role && changes.role === 'user') {
		guardAdmins(db, actorId, userId, 'remove administrator rights from');
	}
	const displayName = changes.displayName?.trim();
	if (displayName !== undefined && (displayName.length === 0 || displayName.length > 64)) {
		throw new AdminError('Display name must be 1–64 characters.');
	}
	db.update(users)
		.set({
			...(displayName !== undefined && { displayName }),
			...(changes.role && { role: changes.role }),
			updatedAt: Date.now()
		})
		.where(eq(users.id, userId))
		.run();
	return target(db, userId);
}

export function setDisabled(db: DB, actorId: string | null, userId: string, disabled: boolean) {
	const user = disabled ? guardAdmins(db, actorId, userId, 'disable') : target(db, userId);
	db.transaction((tx) => {
		tx.update(users).set({ disabled, updatedAt: Date.now() }).where(eq(users.id, userId)).run();
		if (disabled) revokeUserSessions(tx as unknown as DB, userId);
	});
	return user;
}

export function deleteUser(db: DB, actorId: string | null, userId: string) {
	const user = guardAdmins(db, actorId, userId, 'delete');
	// Sessions, factors, codes, attempts and preferences cascade.
	db.delete(users).where(eq(users.id, userId)).run();
	return user;
}

/**
 * Removes every passkey, authenticator and recovery code of a user and signs them out
 * everywhere; they must enroll again at their next sign-in.
 */
export function resetMfa(db: DB, userId: string) {
	const user = target(db, userId);
	db.transaction((tx) => {
		tx.delete(webauthnCredentials).where(eq(webauthnCredentials.userId, userId)).run();
		tx.delete(totpAuthenticators).where(eq(totpAuthenticators.userId, userId)).run();
		tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId)).run();
		tx.delete(authChallenges).where(eq(authChallenges.userId, userId)).run();
		tx.delete(loginAttempts).where(eq(loginAttempts.userId, userId)).run();
		revokeUserSessions(tx as unknown as DB, userId);
	});
	return user;
}
