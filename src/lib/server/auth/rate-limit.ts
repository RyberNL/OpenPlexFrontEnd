import { eq, sql } from 'drizzle-orm';
import type { DB } from '../db';
import { loginAttempts } from '../db/schema';

/**
 * In-memory sliding-window limiter keyed by client IP. Single-process deployment, so memory is
 * sufficient; state resets on restart.
 */
export class SlidingWindowLimiter {
	private hits = new Map<string, number[]>();

	constructor(
		readonly limit: number,
		readonly windowMs: number
	) {}

	/** Records an attempt and returns whether it is allowed. Rejected attempts are not recorded. */
	attempt(key: string, now = Date.now()) {
		const recent = this.recent(key, now);
		if (recent.length >= this.limit) return false;
		recent.push(now);
		this.hits.set(key, recent);
		return true;
	}

	/** Milliseconds until another attempt will be allowed. */
	retryAfter(key: string, now = Date.now()) {
		const recent = this.recent(key, now);
		if (recent.length < this.limit) return 0;
		return recent[0] + this.windowMs - now;
	}

	private recent(key: string, now: number) {
		const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
		if (recent.length === 0) this.hits.delete(key);
		return recent;
	}

	/** Drops expired entries; call periodically to bound memory. */
	prune(now = Date.now()) {
		for (const key of [...this.hits.keys()]) this.recent(key, now);
	}
}

/** 20 sign-in or MFA attempts per IP per 5 minutes (`AUTH_RATE_LIMIT` overrides the count). */
export const ipLimiter = new SlidingWindowLimiter(
	Number(process.env.AUTH_RATE_LIMIT) || 20,
	5 * 60_000
);
/** Passkey challenge creation (e.g. on every sign-in page view), per IP per minute. */
export const challengeLimiter = new SlidingWindowLimiter(
	Number(process.env.AUTH_RATE_LIMIT) || 60,
	60_000
);
setInterval(() => {
	ipLimiter.prune();
	challengeLimiter.prune();
}, 60_000).unref();

export const MAX_CONSECUTIVE_FAILURES = 10;
export const LOCKOUT_DURATION = 15 * 60_000;

/** Returns the lock expiry if the account is currently locked, otherwise null. */
export function accountLockedUntil(db: DB, userId: string, now = Date.now()) {
	const row = db.select().from(loginAttempts).where(eq(loginAttempts.userId, userId)).get();
	return row?.lockedUntil && row.lockedUntil > now ? row.lockedUntil : null;
}

/** Records a failed password or MFA attempt; locks the account after 10 consecutive failures. */
export function recordFailure(db: DB, userId: string, now = Date.now()) {
	return db.transaction((tx) => {
		const row = tx
			.insert(loginAttempts)
			.values({ userId, consecutiveFailures: 1 })
			.onConflictDoUpdate({
				target: loginAttempts.userId,
				set: { consecutiveFailures: sql`${loginAttempts.consecutiveFailures} + 1` }
			})
			.returning()
			.get();
		if (row.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
			const lockedUntil = now + LOCKOUT_DURATION;
			tx.update(loginAttempts)
				.set({ consecutiveFailures: 0, lockedUntil })
				.where(eq(loginAttempts.userId, userId))
				.run();
			return { locked: true as const, lockedUntil };
		}
		return { locked: false as const, failures: row.consecutiveFailures };
	});
}

/** Resets the failure counter after a full, successful authentication. */
export function recordSuccess(db: DB, userId: string) {
	db.delete(loginAttempts).where(eq(loginAttempts.userId, userId)).run();
}
