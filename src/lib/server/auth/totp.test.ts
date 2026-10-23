import { Secret, TOTP } from 'otpauth';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '../db';
import { authChallenges, totpAuthenticators } from '../db/schema';
import { insertUser, testDb } from '../test-utils';
import { beginTotpEnrollment, confirmTotpEnrollment, verifyTotp } from './totp';

const T0 = 1_700_000_010_000; // 10 s into a 30 s step

beforeAll(() => {
	process.env.PUBLIC_ORIGIN = 'https://plex.example.com';
	process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
});

let db: DB;
let user: { id: string; username: string };

beforeEach(() => {
	db = testDb();
	user = insertUser(db, { username: 'anna' });
});

const codeAt = (secret: string, timestamp: number) =>
	new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate({ timestamp });

async function enrolled() {
	const enrollment = await beginTotpEnrollment(db, user, T0);
	const result = confirmTotpEnrollment(
		db,
		user.id,
		enrollment.enrollmentId,
		codeAt(enrollment.secret, T0),
		'Phone',
		T0
	);
	expect(result.ok).toBe(true);
	return enrollment.secret;
}

describe('TOTP enrollment', () => {
	it('provides an otpauth URI and QR code for authenticator apps', async () => {
		const enrollment = await beginTotpEnrollment(db, user, T0);
		expect(enrollment.secret).toMatch(/^[A-Z2-7]{32}$/);
		expect(enrollment.uri).toMatch(
			/^otpauth:\/\/totp\/OpenPlexFrontEnd:anna%40plex\.example\.com\?issuer=OpenPlexFrontEnd&secret=[A-Z2-7]+&algorithm=SHA1&digits=6&period=30$/
		);
		expect(enrollment.qrDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
	});

	it('saves the authenticator, encrypted, only after a valid code', async () => {
		const enrollment = await beginTotpEnrollment(db, user, T0);
		const wrong = confirmTotpEnrollment(
			db,
			user.id,
			enrollment.enrollmentId,
			'000000',
			'Phone',
			T0
		);
		expect(wrong.ok).toBe(false);
		expect(db.select().from(totpAuthenticators).all()).toHaveLength(0);

		const right = confirmTotpEnrollment(
			db,
			user.id,
			enrollment.enrollmentId,
			codeAt(enrollment.secret, T0),
			'Phone',
			T0
		);
		expect(right.ok).toBe(true);
		const [saved] = db.select().from(totpAuthenticators).all();
		expect(saved.name).toBe('Phone');
		expect(saved.secretEnc).not.toContain(enrollment.secret);
		expect(db.select().from(authChallenges).all()).toHaveLength(0);
	});

	it('rejects an expired enrollment', async () => {
		const enrollment = await beginTotpEnrollment(db, user, T0);
		const later = T0 + 11 * 60_000;
		const result = confirmTotpEnrollment(
			db,
			user.id,
			enrollment.enrollmentId,
			codeAt(enrollment.secret, later),
			'Phone',
			later
		);
		expect(result).toEqual({ ok: false, error: 'This setup has expired. Start again.' });
	});

	it("does not let one user confirm another user's enrollment", async () => {
		const enrollment = await beginTotpEnrollment(db, user, T0);
		const other = insertUser(db);
		const result = confirmTotpEnrollment(
			db,
			other.id,
			enrollment.enrollmentId,
			codeAt(enrollment.secret, T0),
			'Phone',
			T0
		);
		expect(result.ok).toBe(false);
	});
});

describe('verifyTotp', () => {
	it('accepts the current code and one adjacent step', async () => {
		const secret = await enrolled();
		const t = T0 + 60_000;
		expect(verifyTotp(db, user.id, codeAt(secret, t - 30_000), t)).toBe(true);
		expect(verifyTotp(db, user.id, codeAt(secret, t + 30_000), t)).toBe(true);
	});

	it('rejects codes more than one step away', async () => {
		const secret = await enrolled();
		const t = T0 + 120_000;
		expect(verifyTotp(db, user.id, codeAt(secret, t - 60_000), t)).toBe(false);
		expect(verifyTotp(db, user.id, codeAt(secret, t + 60_000), t)).toBe(false);
	});

	it('rejects a replayed code within its validity window', async () => {
		const secret = await enrolled();
		const t = T0 + 60_000;
		const code = codeAt(secret, t);
		expect(verifyTotp(db, user.id, code, t)).toBe(true);
		expect(verifyTotp(db, user.id, code, t + 5_000)).toBe(false);
	});

	it('rejects an older code after a newer one was used', async () => {
		const secret = await enrolled();
		const t = T0 + 60_000;
		expect(verifyTotp(db, user.id, codeAt(secret, t), t)).toBe(true);
		expect(verifyTotp(db, user.id, codeAt(secret, t - 30_000), t)).toBe(false);
	});

	it('rejects the enrollment code being reused for sign-in', async () => {
		const secret = await enrolled();
		expect(verifyTotp(db, user.id, codeAt(secret, T0), T0 + 1000)).toBe(false);
	});

	it('accepts codes typed with spaces', async () => {
		const secret = await enrolled();
		const t = T0 + 60_000;
		const code = codeAt(secret, t);
		expect(verifyTotp(db, user.id, `${code.slice(0, 3)} ${code.slice(3)}`, t)).toBe(true);
	});

	it('rejects malformed input and users without authenticators', async () => {
		await enrolled();
		expect(verifyTotp(db, user.id, 'abcdef', T0)).toBe(false);
		expect(verifyTotp(db, insertUser(db).id, '123456', T0)).toBe(false);
	});
});
