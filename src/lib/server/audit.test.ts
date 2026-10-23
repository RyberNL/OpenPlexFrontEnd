import { beforeEach, describe, expect, it } from 'vitest';
import { audit, authFailureLine, listAudit } from './audit';
import type { DB } from './db';
import { insertUser, testDb } from './test-utils';

const T0 = 1_700_000_000_000;
let db: DB;

beforeEach(() => {
	db = testDb();
});

describe('audit', () => {
	it('records actor, target, IP, timestamp and detail', () => {
		const admin = insertUser(db, { username: 'root', role: 'admin' });
		const anna = insertUser(db, { username: 'anna' });
		audit(
			db,
			{
				event: 'admin.mfa_reset',
				actor: admin,
				target: anna,
				ip: '203.0.113.7',
				detail: { reason: 'lost phone' }
			},
			T0
		);
		expect(listAudit(db)).toEqual([
			{
				id: 1,
				at: T0,
				event: 'admin.mfa_reset',
				actorUserId: admin.id,
				actorUsername: 'root',
				targetUserId: anna.id,
				targetUsername: 'anna',
				ip: '203.0.113.7',
				detail: { reason: 'lost phone' }
			}
		]);
	});

	it('records failed sign-ins for unknown usernames', () => {
		audit(db, { event: 'auth.login_failed', target: { username: 'nobody' }, ip: '198.51.100.1' });
		const [entry] = listAudit(db);
		expect(entry.targetUsername).toBe('nobody');
		expect(entry.targetUserId).toBeNull();
		expect(entry.actorUserId).toBeNull();
	});

	it('filters by user and event, newest first, with pagination', () => {
		const anna = insertUser(db, { username: 'anna' });
		const ben = insertUser(db, { username: 'ben' });
		audit(db, { event: 'auth.login_failed', target: anna });
		audit(db, { event: 'auth.login_succeeded', actor: anna, target: anna });
		audit(db, { event: 'auth.login_failed', target: ben });
		audit(db, { event: 'auth.login_failed', target: anna });

		expect(listAudit(db, { userId: anna.id }).map((e) => e.id)).toEqual([4, 2, 1]);
		expect(listAudit(db, { event: 'auth.login_failed' }).map((e) => e.id)).toEqual([4, 3, 1]);
		expect(listAudit(db, { userId: anna.id, event: 'auth.login_failed' }).map((e) => e.id)).toEqual(
			[4, 1]
		);
		expect(listAudit(db, { before: 3, limit: 1 }).map((e) => e.id)).toEqual([2]);
	});
});

describe('authFailureLine', () => {
	it('logs failed sign-ins with event and IP only', () => {
		expect(authFailureLine({ event: 'auth.login_failed', ip: '203.0.113.9' })).toBe(
			'AUTH_FAILURE event=auth.login_failed ip=203.0.113.9'
		);
		expect(authFailureLine({ event: 'auth.mfa_failed', ip: '2001:db8::1' })).toBe(
			'AUTH_FAILURE event=auth.mfa_failed ip=2001:db8::1'
		);
		expect(authFailureLine({ event: 'auth.account_locked', ip: null })).toBe(
			'AUTH_FAILURE event=auth.account_locked ip=-'
		);
	});

	it('ignores other events and anything that is not an IP address', () => {
		expect(authFailureLine({ event: 'auth.login_succeeded', ip: '203.0.113.9' })).toBeNull();
		expect(authFailureLine({ event: 'auth.login_failed', ip: '1.2.3.4\nAUTH_FAILURE x' })).toBe(
			'AUTH_FAILURE event=auth.login_failed ip=-'
		);
	});
});
