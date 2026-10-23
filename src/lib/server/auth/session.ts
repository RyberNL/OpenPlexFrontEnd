import { createHash, randomBytes } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import type { DB } from '../db';
import { sessions, users } from '../db/schema';

export type SessionLevel = (typeof sessions.$inferSelect)['level'];
export type Session = typeof sessions.$inferSelect;
export type User = typeof users.$inferSelect;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Full sessions expire after this much inactivity. */
export const IDLE_TIMEOUT = 14 * DAY;
/** Full sessions expire this long after full authentication, regardless of activity. */
export const ABSOLUTE_TIMEOUT = 30 * DAY;
/** Sessions that have not completed authentication expire quickly. */
export const PENDING_TIMEOUT = 15 * MINUTE;
/** How recently a factor must have been verified for sensitive actions. */
export const STEP_UP_WINDOW = 5 * MINUTE;
/** Avoid writing last_seen_at on every request. */
const TOUCH_INTERVAL = MINUTE;

export const SESSION_COOKIE = 'session';

export function hashToken(token: string) {
	return createHash('sha256').update(token).digest('hex');
}

function newToken() {
	return randomBytes(32).toString('base64url');
}

type ClientInfo = { ip?: string | null; userAgent?: string | null };

export function createSession(
	db: DB,
	userId: string,
	level: SessionLevel,
	client: ClientInfo = {},
	options: { stepUp?: boolean; now?: number } = {}
) {
	const now = options.now ?? Date.now();
	const token = newToken();
	const session = db
		.insert(sessions)
		.values({
			idHash: hashToken(token),
			userId,
			level,
			createdAt: now,
			lastSeenAt: now,
			expiresAt: now + (level === 'full' ? ABSOLUTE_TIMEOUT : PENDING_TIMEOUT),
			stepUpAt: options.stepUp ? now : null,
			ip: client.ip ?? null,
			userAgent: client.userAgent?.slice(0, 512) ?? null
		})
		.returning()
		.get();
	return { token, session };
}

function isExpired(session: Session, now: number) {
	if (now >= session.expiresAt) return true;
	return session.level === 'full' && now - session.lastSeenAt >= IDLE_TIMEOUT;
}

/**
 * Resolves a cookie token to its session and user. Returns null (and deletes the row) when the
 * session is expired or the user is disabled. Refreshes last-seen time.
 */
export function validateSession(db: DB, token: string, now = Date.now()) {
	const idHash = hashToken(token);
	const row = db
		.select({ session: sessions, user: users })
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(eq(sessions.idHash, idHash))
		.get();
	if (!row) return null;
	if (isExpired(row.session, now) || row.user.disabled) {
		db.delete(sessions).where(eq(sessions.idHash, idHash)).run();
		return null;
	}
	if (now - row.session.lastSeenAt >= TOUCH_INTERVAL) {
		db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.idHash, idHash)).run();
		row.session.lastSeenAt = now;
	}
	return row;
}

/**
 * Replaces a session with a new one at a different authentication level. The old token stops
 * working immediately (session fixation protection).
 */
export function rotateSession(
	db: DB,
	session: Session,
	level: SessionLevel,
	options: { stepUp?: boolean; now?: number } = {}
) {
	return db.transaction((tx) => {
		tx.delete(sessions).where(eq(sessions.idHash, session.idHash)).run();
		return createSession(
			tx as unknown as DB,
			session.userId,
			level,
			{ ip: session.ip, userAgent: session.userAgent },
			{ stepUp: options.stepUp ?? session.stepUpAt !== null, now: options.now }
		);
	});
}

/** Records that a second factor was just verified in this session. */
export function markStepUp(db: DB, idHash: string, now = Date.now()) {
	db.update(sessions).set({ stepUpAt: now }).where(eq(sessions.idHash, idHash)).run();
}

export function hasRecentStepUp(session: Session, now = Date.now()) {
	return session.stepUpAt !== null && now - session.stepUpAt < STEP_UP_WINDOW;
}

export function revokeSession(db: DB, idHash: string) {
	db.delete(sessions).where(eq(sessions.idHash, idHash)).run();
}

/** Revokes a session only if it belongs to `userId`; returns whether one was removed. */
export function revokeUserSession(db: DB, userId: string, idHash: string) {
	const result = db
		.delete(sessions)
		.where(and(eq(sessions.idHash, idHash), eq(sessions.userId, userId)))
		.run();
	return result.changes > 0;
}

/** Revokes all of a user's sessions, optionally keeping one (the current session). */
export function revokeUserSessions(db: DB, userId: string, exceptIdHash?: string) {
	const condition = exceptIdHash
		? and(eq(sessions.userId, userId), ne(sessions.idHash, exceptIdHash))
		: eq(sessions.userId, userId);
	db.delete(sessions).where(condition).run();
}

/** Active full sessions of a user, newest activity first. */
export function listUserSessions(db: DB, userId: string, now = Date.now()) {
	return db
		.select()
		.from(sessions)
		.where(and(eq(sessions.userId, userId), eq(sessions.level, 'full')))
		.all()
		.filter((session) => !isExpired(session, now))
		.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

/** Cookie attributes for the session cookie. `secure` is false only for http://localhost development. */
export function sessionCookieOptions(secure: boolean, level: SessionLevel) {
	return {
		path: '/',
		httpOnly: true,
		secure,
		sameSite: 'lax' as const,
		maxAge: (level === 'full' ? ABSOLUTE_TIMEOUT : PENDING_TIMEOUT) / 1000
	};
}
