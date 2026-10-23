import { randomUUID } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';
import { config } from '../config';
import { decrypt, encrypt } from '../crypto';
import { contexts } from '../crypto-contexts';
import type { DB } from '../db';
import { authChallenges, totpAuthenticators } from '../db/schema';

const PERIOD = 30;
const DIGITS = 6;
/** Pending enrollments expire after 10 minutes. */
const ENROLL_TTL = 10 * 60_000;

function totp(base32: string, label = '') {
	return new TOTP({
		issuer: 'OpenPlexFrontEnd',
		label,
		secret: Secret.fromBase32(base32),
		algorithm: 'SHA1',
		digits: DIGITS,
		period: PERIOD
	});
}

const secretContext = contexts.totpSecret;
const enrollContext = contexts.totpEnrollment;

export function normalizeCode(code: string) {
	return code.replace(/[\s-]/g, '');
}

/** Starts TOTP enrollment: a new secret held server-side until confirmed with a valid code. */
export async function beginTotpEnrollment(
	db: DB,
	user: { id: string; username: string },
	now = Date.now()
) {
	const secret = new Secret({ size: 20 });
	const id = randomUUID();
	db.insert(authChallenges)
		.values({
			id,
			purpose: 'totp_enroll',
			userId: user.id,
			value: encrypt(secret.base32, enrollContext(user.id)),
			expiresAt: now + ENROLL_TTL
		})
		.run();
	return enrollmentView(user, id, secret.base32);
}

function enrollmentView(user: { username: string }, id: string, base32: string) {
	const uri = totp(base32, `${user.username}@${config().rpId}`).toString();
	return QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(
		(svg) => ({
			enrollmentId: id,
			secret: base32,
			uri,
			qrDataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
		})
	);
}

/** Re-renders a still-valid pending enrollment (e.g. after a mistyped code). */
export async function pendingEnrollment(
	db: DB,
	user: { id: string; username: string },
	enrollmentId: string,
	now = Date.now()
) {
	const pending = db
		.select()
		.from(authChallenges)
		.where(
			and(
				eq(authChallenges.id, enrollmentId),
				eq(authChallenges.userId, user.id),
				eq(authChallenges.purpose, 'totp_enroll'),
				gt(authChallenges.expiresAt, now)
			)
		)
		.get();
	if (!pending) return null;
	return enrollmentView(user, pending.id, decrypt(pending.value, enrollContext(user.id)));
}

/** Validates `code` against `base32`, returning the matched time step or null. */
function matchStep(base32: string, code: string, now: number) {
	const delta = totp(base32).validate({ token: code, timestamp: now, window: 1 });
	if (delta === null) return null;
	return Math.floor(now / 1000 / PERIOD) + delta;
}

export type ConfirmResult = { ok: true; authenticatorId: string } | { ok: false; error: string };

/** Completes enrollment if `code` is valid for the pending secret. */
export function confirmTotpEnrollment(
	db: DB,
	userId: string,
	enrollmentId: string,
	code: string,
	name: string,
	now = Date.now()
): ConfirmResult {
	const pending = db
		.select()
		.from(authChallenges)
		.where(
			and(
				eq(authChallenges.id, enrollmentId),
				eq(authChallenges.userId, userId),
				eq(authChallenges.purpose, 'totp_enroll'),
				gt(authChallenges.expiresAt, now)
			)
		)
		.get();
	if (!pending) return { ok: false, error: 'This setup has expired. Start again.' };

	const secret = decrypt(pending.value, enrollContext(userId));
	const step = matchStep(secret, normalizeCode(code), now);
	if (step === null) {
		return {
			ok: false,
			error: 'That code is not correct. Check the time on your device and try again.'
		};
	}

	const authenticatorId = randomUUID();
	db.transaction((tx) => {
		tx.delete(authChallenges).where(eq(authChallenges.id, enrollmentId)).run();
		tx.insert(totpAuthenticators)
			.values({
				id: authenticatorId,
				userId,
				name: name.trim().slice(0, 64) || 'Authenticator app',
				secretEnc: encrypt(secret, secretContext(userId)),
				lastUsedStep: step,
				createdAt: now,
				lastUsedAt: now
			})
			.run();
	});
	return { ok: true, authenticatorId };
}

/**
 * Verifies a code against the user's authenticators. A code (time step) that was already accepted
 * for an authenticator is rejected, so intercepted codes cannot be replayed.
 */
export function verifyTotp(db: DB, userId: string, code: string, now = Date.now()) {
	const normalized = normalizeCode(code);
	if (!/^\d{6}$/.test(normalized)) return false;
	const authenticators = db
		.select()
		.from(totpAuthenticators)
		.where(eq(totpAuthenticators.userId, userId))
		.all();
	for (const authenticator of authenticators) {
		const step = matchStep(
			decrypt(authenticator.secretEnc, secretContext(userId)),
			normalized,
			now
		);
		if (step === null) continue;
		if (authenticator.lastUsedStep !== null && step <= authenticator.lastUsedStep) return false;
		db.update(totpAuthenticators)
			.set({ lastUsedStep: step, lastUsedAt: now })
			.where(eq(totpAuthenticators.id, authenticator.id))
			.run();
		return true;
	}
	return false;
}
