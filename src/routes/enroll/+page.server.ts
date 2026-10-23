import { fail, redirect } from '@sveltejs/kit';
import { audit } from '#lib/server/audit.js';
import { completeAuthentication } from '#lib/server/auth/flow.js';
import { initialRecoveryCodes } from '#lib/server/auth/recovery.js';
import { clientInfo } from '#lib/server/auth/request.js';
import {
	beginTotpEnrollment,
	confirmTotpEnrollment,
	pendingEnrollment
} from '#lib/server/auth/totp.js';
import { db } from '#lib/server/db/index.js';
import type { Actions } from './$types';

export const actions: Actions = {
	totpStart: async ({ locals }) => {
		const { enrollmentId, secret, qrDataUrl } = await beginTotpEnrollment(db(), locals.user!);
		return { enrollment: { enrollmentId, secret, qrDataUrl } };
	},

	totpConfirm: async (event) => {
		const user = event.locals.user!;
		const form = await event.request.formData();
		const enrollmentId = String(form.get('enrollmentId') ?? '');
		const result = confirmTotpEnrollment(
			db(),
			user.id,
			enrollmentId,
			String(form.get('code') ?? ''),
			String(form.get('name') ?? '')
		);
		if (!result.ok) {
			// Keep showing the same QR code so the user can retry.
			const pending = await pendingEnrollment(db(), user, enrollmentId);
			const enrollment = pending && {
				enrollmentId: pending.enrollmentId,
				secret: pending.secret,
				qrDataUrl: pending.qrDataUrl
			};
			return fail(400, { enrollment, totpError: result.error });
		}
		const { ip } = clientInfo(event);
		audit(db(), { event: 'mfa.totp_enrolled', actor: user, target: user, ip });
		const recoveryCodes = initialRecoveryCodes(db(), user.id);
		const next = completeAuthentication(event, user, 'totp_enroll');
		if (!recoveryCodes) redirect(303, next);
		audit(db(), { event: 'mfa.recovery_codes_generated', actor: user, target: user, ip });
		return { recoveryCodes, next };
	}
};
