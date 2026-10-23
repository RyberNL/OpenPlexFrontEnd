import { randomUUID } from 'node:crypto';
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
	type AuthenticationResponseJSON,
	type RegistrationResponseJSON
} from '@simplewebauthn/server';
import { and, eq, lte } from 'drizzle-orm';
import { config } from '../config';
import type { DB } from '../db';
import { authChallenges, webauthnCredentials } from '../db/schema';
import type { User } from './session';

const CHALLENGE_TTL = 5 * 60_000;
const RP_NAME = 'OpenPlexFrontEnd';

type Purpose = 'webauthn_register' | 'webauthn_authenticate' | 'webauthn_login';

export class PasskeyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PasskeyError';
	}
}

function storeChallenge(
	db: DB,
	purpose: Purpose,
	challenge: string,
	userId: string | null,
	sessionHash: string | null,
	now = Date.now()
) {
	const id = randomUUID();
	db.insert(authChallenges)
		.values({ id, purpose, userId, sessionHash, value: challenge, expiresAt: now + CHALLENGE_TTL })
		.run();
	return id;
}

/** Takes (and deletes) a pending challenge; it can be used only once. */
function takeChallenge(
	db: DB,
	id: string,
	purpose: Purpose,
	sessionHash: string | null,
	now = Date.now()
) {
	const row = db
		.delete(authChallenges)
		.where(and(eq(authChallenges.id, id), eq(authChallenges.purpose, purpose)))
		.returning()
		.get();
	if (!row || row.expiresAt <= now)
		throw new PasskeyError('This passkey request expired. Try again.');
	if (row.sessionHash !== sessionHash) throw new PasskeyError('This passkey request is not valid.');
	return row;
}

function userCredentials(db: DB, userId: string) {
	return db.select().from(webauthnCredentials).where(eq(webauthnCredentials.userId, userId)).all();
}

const descriptor = (c: typeof webauthnCredentials.$inferSelect) => ({
	id: c.id,
	transports: c.transports ?? undefined
});

export async function registrationOptions(db: DB, user: User, sessionHash: string) {
	const options = await generateRegistrationOptions({
		rpName: RP_NAME,
		rpID: config().rpId,
		userName: user.username,
		userDisplayName: user.displayName,
		userID: Buffer.from(user.webauthnUserId, 'base64url'),
		attestationType: 'none',
		excludeCredentials: userCredentials(db, user.id).map(descriptor),
		authenticatorSelection: { residentKey: 'required', userVerification: 'required' }
	});
	const challengeId = storeChallenge(
		db,
		'webauthn_register',
		options.challenge,
		user.id,
		sessionHash
	);
	return { challengeId, options };
}

export async function verifyRegistration(
	db: DB,
	user: User,
	sessionHash: string,
	challengeId: string,
	response: RegistrationResponseJSON,
	name: string
) {
	const challenge = takeChallenge(db, challengeId, 'webauthn_register', sessionHash);
	if (challenge.userId !== user.id) throw new PasskeyError('This passkey request is not valid.');

	let result;
	try {
		result = await verifyRegistrationResponse({
			response,
			expectedChallenge: challenge.value,
			expectedOrigin: config().publicOrigin,
			expectedRPID: config().rpId,
			requireUserVerification: true
		});
	} catch (error) {
		throw new PasskeyError(`The passkey could not be verified: ${(error as Error).message}`);
	}
	if (!result.verified) throw new PasskeyError('The passkey could not be verified.');

	const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
	if (
		db.select().from(webauthnCredentials).where(eq(webauthnCredentials.id, credential.id)).get()
	) {
		throw new PasskeyError('This passkey is already registered.');
	}
	return db
		.insert(webauthnCredentials)
		.values({
			id: credential.id,
			userId: user.id,
			publicKey: Buffer.from(credential.publicKey),
			counter: credential.counter,
			transports: credential.transports ?? null,
			deviceType: credentialDeviceType,
			backedUp: credentialBackedUp,
			name: name.trim().slice(0, 64) || 'Passkey',
			createdAt: Date.now()
		})
		.returning()
		.get();
}

/**
 * Options for a passkey assertion. With a user, only their passkeys are allowed (second factor or
 * step-up); without one, any discoverable passkey may answer (passwordless sign-in).
 */
export async function authenticationOptions(db: DB, user: User | null, sessionHash: string | null) {
	const purpose: Purpose = user ? 'webauthn_authenticate' : 'webauthn_login';
	const options = await generateAuthenticationOptions({
		rpID: config().rpId,
		userVerification: 'required',
		allowCredentials: user ? userCredentials(db, user.id).map(descriptor) : []
	});
	const challengeId = storeChallenge(db, purpose, options.challenge, user?.id ?? null, sessionHash);
	return { challengeId, options };
}

/**
 * Verifies a passkey assertion and returns the id of the user it belongs to. With `expectedUserId`,
 * a passkey of any other account is rejected.
 */
export async function verifyAuthentication(
	db: DB,
	expectedUserId: string | null,
	sessionHash: string | null,
	challengeId: string,
	response: AuthenticationResponseJSON
) {
	const purpose: Purpose = expectedUserId ? 'webauthn_authenticate' : 'webauthn_login';
	const challenge = takeChallenge(db, challengeId, purpose, sessionHash);
	const credential = db
		.select()
		.from(webauthnCredentials)
		.where(eq(webauthnCredentials.id, response.id))
		.get();
	if (!credential) throw new PasskeyError('This passkey is not registered.');
	if (expectedUserId && credential.userId !== expectedUserId) {
		throw new PasskeyError('This passkey belongs to a different account.');
	}

	let result;
	try {
		result = await verifyAuthenticationResponse({
			response,
			expectedChallenge: challenge.value,
			expectedOrigin: config().publicOrigin,
			expectedRPID: config().rpId,
			requireUserVerification: true,
			credential: {
				id: credential.id,
				publicKey: new Uint8Array(credential.publicKey),
				counter: credential.counter,
				transports: credential.transports ?? undefined
			}
		});
	} catch (error) {
		throw new PasskeyError(`The passkey could not be verified: ${(error as Error).message}`);
	}
	if (!result.verified) throw new PasskeyError('The passkey could not be verified.');

	db.update(webauthnCredentials)
		.set({
			counter: result.authenticationInfo.newCounter,
			backedUp: result.authenticationInfo.credentialBackedUp,
			lastUsedAt: Date.now()
		})
		.where(eq(webauthnCredentials.id, credential.id))
		.run();
	return credential.userId;
}

/** Removes expired challenges and pending enrollments. */
export function pruneChallenges(db: DB, now = Date.now()) {
	db.delete(authChallenges).where(lte(authChallenges.expiresAt, now)).run();
}
