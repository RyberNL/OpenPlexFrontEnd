import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '../db';
import { sessions, users } from '../db/schema';
import { insertUser, testDb } from '../test-utils';
import {
	ABSOLUTE_TIMEOUT,
	createSession,
	hashToken,
	hasRecentStepUp,
	IDLE_TIMEOUT,
	listUserSessions,
	markStepUp,
	PENDING_TIMEOUT,
	revokeSession,
	revokeUserSession,
	revokeUserSessions,
	rotateSession,
	STEP_UP_WINDOW,
	validateSession
} from './session';

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;

let db: DB;
let userId: string;

beforeEach(() => {
	db = testDb();
	userId = insertUser(db).id;
});

describe('createSession', () => {
	it('stores only a hash of the opaque token', () => {
		const { token, session } = createSession(db, userId, 'full', {}, { now: T0 });
		expect(token).toMatch(/^[\w-]{43}$/);
		expect(session.idHash).toBe(hashToken(token));
		expect(JSON.stringify(db.select().from(sessions).all())).not.toContain(token);
	});

	it('gives pending sessions a short lifetime', () => {
		const { session } = createSession(db, userId, 'pending_mfa', {}, { now: T0 });
		expect(session.expiresAt).toBe(T0 + PENDING_TIMEOUT);
		expect(createSession(db, userId, 'full', {}, { now: T0 }).session.expiresAt).toBe(
			T0 + ABSOLUTE_TIMEOUT
		);
	});
});

describe('validateSession', () => {
	it('returns the session and user for a valid token', () => {
		const { token } = createSession(db, userId, 'full', {}, { now: T0 });
		const result = validateSession(db, token, T0 + 1000);
		expect(result?.user.id).toBe(userId);
		expect(result?.session.level).toBe('full');
	});

	it('returns null for an unknown token', () => {
		expect(validateSession(db, 'nope', T0)).toBeNull();
	});

	it('expires a session after 14 days of inactivity', () => {
		const { token } = createSession(db, userId, 'full', {}, { now: T0 });
		expect(validateSession(db, token, T0 + IDLE_TIMEOUT - 1)).not.toBeNull();
		// The previous call refreshed last-seen, so measure idle time from there.
		expect(validateSession(db, token, T0 + 2 * IDLE_TIMEOUT - 1)).toBeNull();
		expect(db.select().from(sessions).all()).toHaveLength(0);
	});

	it('keeps an active session alive until the 30-day absolute limit', () => {
		const { token } = createSession(db, userId, 'full', {}, { now: T0 });
		for (let day = 1; day < 30; day++) {
			expect(validateSession(db, token, T0 + day * DAY)).not.toBeNull();
		}
		expect(validateSession(db, token, T0 + ABSOLUTE_TIMEOUT)).toBeNull();
	});

	it('expires a pending session after 15 minutes', () => {
		const { token } = createSession(db, userId, 'pending_mfa', {}, { now: T0 });
		expect(validateSession(db, token, T0 + PENDING_TIMEOUT)).toBeNull();
	});

	it('rejects and removes sessions of disabled users', () => {
		const { token } = createSession(db, userId, 'full', {}, { now: T0 });
		db.update(users).set({ disabled: true }).where(eq(users.id, userId)).run();
		expect(validateSession(db, token, T0)).toBeNull();
		expect(db.select().from(sessions).all()).toHaveLength(0);
	});
});

describe('rotateSession', () => {
	it('issues a new token and invalidates the old one when the level changes', () => {
		const pending = createSession(db, userId, 'pending_mfa', { ip: '10.0.0.1' }, { now: T0 });
		const rotated = rotateSession(db, pending.session, 'full', { stepUp: true, now: T0 + 5 });
		expect(rotated.token).not.toBe(pending.token);
		expect(validateSession(db, pending.token, T0 + 10)).toBeNull();
		const result = validateSession(db, rotated.token, T0 + 10);
		expect(result?.session.level).toBe('full');
		expect(result?.session.ip).toBe('10.0.0.1');
		expect(result?.session.stepUpAt).toBe(T0 + 5);
		expect(result?.session.expiresAt).toBe(T0 + 5 + ABSOLUTE_TIMEOUT);
	});
});

describe('step-up', () => {
	it('is recent for 5 minutes after a factor is verified', () => {
		const { session } = createSession(db, userId, 'full', {}, { now: T0 });
		expect(hasRecentStepUp(session, T0)).toBe(false);
		markStepUp(db, session.idHash, T0);
		const updated = db.select().from(sessions).get()!;
		expect(hasRecentStepUp(updated, T0 + STEP_UP_WINDOW - 1)).toBe(true);
		expect(hasRecentStepUp(updated, T0 + STEP_UP_WINDOW)).toBe(false);
	});
});

describe('revocation', () => {
	it('revokes a single session (sign-out)', () => {
		const { token, session } = createSession(db, userId, 'full', {}, { now: T0 });
		revokeSession(db, session.idHash);
		expect(validateSession(db, token, T0)).toBeNull();
	});

	it('only lets a user revoke their own sessions', () => {
		const other = insertUser(db).id;
		const { token, session } = createSession(db, other, 'full', {}, { now: T0 });
		expect(revokeUserSession(db, userId, session.idHash)).toBe(false);
		expect(validateSession(db, token, T0)).not.toBeNull();
		expect(revokeUserSession(db, other, session.idHash)).toBe(true);
	});

	it('revokes all other sessions of a user, keeping the current one', () => {
		const current = createSession(db, userId, 'full', {}, { now: T0 });
		const laptop = createSession(db, userId, 'full', {}, { now: T0 });
		const phone = createSession(db, userId, 'full', {}, { now: T0 });
		const otherUser = createSession(db, insertUser(db).id, 'full', {}, { now: T0 });
		revokeUserSessions(db, userId, current.session.idHash);
		expect(validateSession(db, current.token, T0)).not.toBeNull();
		expect(validateSession(db, laptop.token, T0)).toBeNull();
		expect(validateSession(db, phone.token, T0)).toBeNull();
		expect(validateSession(db, otherUser.token, T0)).not.toBeNull();
	});

	it('lists active full sessions, most recently used first', () => {
		createSession(db, userId, 'pending_mfa', {}, { now: T0 });
		const older = createSession(db, userId, 'full', {}, { now: T0 });
		const newer = createSession(db, userId, 'full', {}, { now: T0 + 1000 });
		expect(listUserSessions(db, userId, T0 + 2000).map((s) => s.idHash)).toEqual([
			newer.session.idHash,
			older.session.idHash
		]);
	});
});
