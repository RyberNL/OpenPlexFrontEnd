import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { mfaAttemptBlocked, mfaFailed } from '#lib/server/auth/attempts.js';
import { completeAuthentication } from '#lib/server/auth/flow.js';
import { passkeyErrorResponse, readVerifyBody } from '#lib/server/auth/passkey-api.js';
import { PasskeyError, verifyAuthentication } from '#lib/server/auth/passkeys.js';
import { markStepUp } from '#lib/server/auth/session.js';
import { db } from '#lib/server/db/index.js';
import type { RequestHandler } from './$types';

/** Verifies a passkey as the second factor (pending sessions) or as a step-up (full sessions). */
export const POST: RequestHandler = async (event) => {
	const user = event.locals.user!;
	const session = event.locals.session!;
	const blocked = mfaAttemptBlocked(event, user);
	if (blocked) return Response.json({ message: blocked }, { status: 429 });

	const body = await readVerifyBody(event);
	try {
		await verifyAuthentication(
			db(),
			user.id,
			session.idHash,
			body.challengeId,
			body.response as unknown as AuthenticationResponseJSON
		);
	} catch (e) {
		if (e instanceof PasskeyError) {
			const locked = mfaFailed(event, user, 'passkey');
			return Response.json({ message: locked ?? e.message }, { status: locked ? 429 : 400 });
		}
		return passkeyErrorResponse(e);
	}

	if (session.level === 'full') {
		markStepUp(db(), session.idHash);
		return Response.json({ ok: true });
	}
	return Response.json({ redirect: completeAuthentication(event, user, 'passkey') });
};
