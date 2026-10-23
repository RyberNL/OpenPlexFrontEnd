import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '../db';
import { insertUser, testDb } from '../test-utils';
import {
	accountLockedUntil,
	LOCKOUT_DURATION,
	recordFailure,
	recordSuccess,
	SlidingWindowLimiter
} from './rate-limit';

const T0 = 1_700_000_000_000;

describe('SlidingWindowLimiter', () => {
	it('allows up to the limit within the window, then rejects', () => {
		const limiter = new SlidingWindowLimiter(3, 60_000);
		expect([1, 2, 3, 4].map((i) => limiter.attempt('1.2.3.4', T0 + i))).toEqual([
			true,
			true,
			true,
			false
		]);
		expect(limiter.attempt('5.6.7.8', T0)).toBe(true);
	});

	it('slides: old attempts stop counting after the window', () => {
		const limiter = new SlidingWindowLimiter(2, 60_000);
		limiter.attempt('ip', T0);
		limiter.attempt('ip', T0 + 30_000);
		expect(limiter.attempt('ip', T0 + 59_999)).toBe(false);
		expect(limiter.retryAfter('ip', T0 + 59_999)).toBe(1);
		expect(limiter.attempt('ip', T0 + 60_000)).toBe(true);
		expect(limiter.attempt('ip', T0 + 60_001)).toBe(false);
	});

	it('does not record rejected attempts', () => {
		const limiter = new SlidingWindowLimiter(1, 60_000);
		limiter.attempt('ip', T0);
		for (let i = 1; i < 50; i++) limiter.attempt('ip', T0 + i * 1000);
		expect(limiter.attempt('ip', T0 + 60_000)).toBe(true);
	});
});

describe('account lockout', () => {
	let db: DB;
	let userId: string;

	beforeEach(() => {
		db = testDb();
		userId = insertUser(db).id;
	});

	it('locks after 10 consecutive failures for 15 minutes', () => {
		for (let i = 1; i <= 9; i++) {
			expect(recordFailure(db, userId, T0)).toEqual({ locked: false, failures: i });
		}
		expect(accountLockedUntil(db, userId, T0)).toBeNull();
		expect(recordFailure(db, userId, T0)).toEqual({
			locked: true,
			lockedUntil: T0 + LOCKOUT_DURATION
		});
		expect(accountLockedUntil(db, userId, T0 + LOCKOUT_DURATION - 1)).toBe(T0 + LOCKOUT_DURATION);
		expect(accountLockedUntil(db, userId, T0 + LOCKOUT_DURATION)).toBeNull();
	});

	it('allows another 10 attempts after the lock expires', () => {
		for (let i = 0; i < 10; i++) recordFailure(db, userId, T0);
		const later = T0 + LOCKOUT_DURATION;
		expect(recordFailure(db, userId, later)).toEqual({ locked: false, failures: 1 });
	});

	it('resets the counter on success', () => {
		for (let i = 0; i < 9; i++) recordFailure(db, userId, T0);
		recordSuccess(db, userId);
		expect(recordFailure(db, userId, T0)).toEqual({ locked: false, failures: 1 });
	});

	it('tracks accounts independently', () => {
		const other = insertUser(db).id;
		for (let i = 0; i < 10; i++) recordFailure(db, userId, T0);
		expect(accountLockedUntil(db, other, T0)).toBeNull();
	});
});
