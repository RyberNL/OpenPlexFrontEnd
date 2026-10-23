import { fail, redirect } from '@sveltejs/kit';
import { factorSummary } from '#lib/server/auth/accounts.js';
import { mfaAttemptBlocked, mfaFailed } from '#lib/server/auth/attempts.js';
import { audit } from '#lib/server/audit.js';
import { completeAuthentication } from '#lib/server/auth/flow.js';
import { remainingRecoveryCodes, useRecoveryCode } from '#lib/server/auth/recovery.js';
import { clientInfo } from '#lib/server/auth/request.js';
import { verifyTotp } from '#lib/server/auth/totp.js';
import { db } from '#lib/server/db/index.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const { passkeys, totps } = factorSummary(db(), locals.user!.id);
	return { hasPasskey: passkeys > 0, hasTotp: totps > 0 };
};

export const actions: Actions = {
	totp: async (event) => {
		const user = event.locals.user!;
		const blocked = mfaAttemptBlocked(event, user);
		if (blocked) return fail(429, { error: blocked });

		const code = String((await event.request.formData()).get('code') ?? '');
		if (!verifyTotp(db(), user.id, code)) {
			const locked = mfaFailed(event, user, 'totp');
			return fail(400, { error: locked ?? 'That code is not correct.' });
		}
		redirect(303, completeAuthentication(event, user, 'totp'));
	},

	recovery: async (event) => {
		const user = event.locals.user!;
		const blocked = mfaAttemptBlocked(event, user);
		if (blocked) return fail(429, { recoveryError: blocked });

		const code = String((await event.request.formData()).get('recoveryCode') ?? '');
		if (!useRecoveryCode(db(), user.id, code)) {
			const locked = mfaFailed(event, user, 'recovery_code');
			return fail(400, { recoveryError: locked ?? 'That recovery code is not valid.' });
		}
		audit(db(), {
			event: 'mfa.recovery_code_used',
			actor: user,
			target: user,
			ip: clientInfo(event).ip,
			detail: { remaining: remainingRecoveryCodes(db(), user.id) }
		});
		redirect(303, completeAuthentication(event, user, 'recovery_code'));
	}
};
