import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { audit } from '#lib/server/audit.js';
import { completeAuthentication } from '#lib/server/auth/flow.js';
import { passkeyErrorResponse, readVerifyBody } from '#lib/server/auth/passkey-api.js';
import { verifyRegistration } from '#lib/server/auth/passkeys.js';
import { initialRecoveryCodes } from '#lib/server/auth/recovery.js';
import { clientInfo } from '#lib/server/auth/request.js';
import { hasRecentStepUp } from '#lib/server/auth/session.js';
import { db } from '#lib/server/db/index.js';
import { describeUserAgent } from '#lib/user-agent.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user!;
	const session = event.locals.session!;
	if (session.level === 'full' && !hasRecentStepUp(session)) {
		return Response.json(
			{ message: 'Verify it’s you first.', code: 'step_up_required' },
			{ status: 403 }
		);
	}
	const body = await readVerifyBody(event);
	const { ip, userAgent } = clientInfo(event);
	let credential;
	try {
		credential = await verifyRegistration(
			db(),
			user,
			session.idHash,
			body.challengeId,
			body.response as unknown as RegistrationResponseJSON,
			body.name || describeUserAgent(userAgent)
		);
	} catch (e) {
		return passkeyErrorResponse(e);
	}
	audit(db(), {
		event: 'mfa.passkey_registered',
		actor: user,
		target: user,
		ip,
		detail: { name: credential.name }
	});
	if (session.level === 'pending_mfa_enroll') {
		const recoveryCodes = initialRecoveryCodes(db(), user.id);
		if (recoveryCodes) {
			audit(db(), { event: 'mfa.recovery_codes_generated', actor: user, target: user, ip });
		}
		const redirect = completeAuthentication(event, user, 'passkey_enroll');
		return Response.json({ redirect, recoveryCodes });
	}
	return Response.json({ ok: true, id: credential.id, name: credential.name });
};
