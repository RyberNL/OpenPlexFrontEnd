import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { z } from 'zod';
import { audit } from '#lib/server/audit.js';
import { findUserById } from '#lib/server/auth/accounts.js';
import { completeAuthentication, lockedMessage, rememberReturnTo } from '#lib/server/auth/flow.js';
import { passkeyErrorResponse, readVerifyBody } from '#lib/server/auth/passkey-api.js';
import { PasskeyError, verifyAuthentication } from '#lib/server/auth/passkeys.js';
import { accountLockedUntil, ipLimiter } from '#lib/server/auth/rate-limit.js';
import { clientInfo, setSession } from '#lib/server/auth/request.js';
import { db } from '#lib/server/db/index.js';
import type { RequestHandler } from './$types';

/** Passwordless sign-in: a discoverable passkey with user verification fully authenticates. */
export const POST: RequestHandler = async (event) => {
	const { returnTo } = z.object({ returnTo: z.string().optional() }).parse(
		await event.request
			.clone()
			.json()
			.catch(() => ({}))
	);
	const body = await readVerifyBody(event);
	const { ip } = clientInfo(event);
	if (!ipLimiter.attempt(ip ?? 'unknown')) {
		return Response.json({ message: 'Too many attempts. Try again later.' }, { status: 429 });
	}

	let userId;
	try {
		userId = await verifyAuthentication(
			db(),
			null,
			null,
			body.challengeId,
			body.response as unknown as AuthenticationResponseJSON
		);
	} catch (e) {
		if (e instanceof PasskeyError) {
			audit(db(), {
				event: 'auth.login_failed',
				ip,
				detail: { method: 'passkey', reason: e.message }
			});
		}
		return passkeyErrorResponse(e);
	}

	const user = findUserById(db(), userId)!;
	if (user.disabled) {
		audit(db(), { event: 'auth.login_failed', target: user, ip, detail: { reason: 'disabled' } });
		return Response.json({ message: 'This account has been disabled.' }, { status: 403 });
	}
	const lockedUntil = accountLockedUntil(db(), user.id);
	if (lockedUntil) return Response.json({ message: lockedMessage(lockedUntil) }, { status: 429 });

	rememberReturnTo(event, returnTo ?? null);
	if (user.mustChangePassword) {
		setSession(event, user.id, 'pending_password_change');
		return Response.json({ redirect: '/change-password' });
	}
	return Response.json({ redirect: completeAuthentication(event, user, 'passkey_passwordless') });
};
