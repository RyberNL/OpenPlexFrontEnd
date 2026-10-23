import { fail, type RequestEvent } from '@sveltejs/kit';
import { audit } from '#lib/server/audit.js';
import { factorSummary } from '#lib/server/auth/accounts.js';
import { mfaAttemptBlocked, mfaFailed } from '#lib/server/auth/attempts.js';
import {
	FactorError,
	listFactors,
	removeFactor,
	renameFactor,
	type FactorKind
} from '#lib/server/auth/factors.js';
import { generateRecoveryCodes, remainingRecoveryCodes } from '#lib/server/auth/recovery.js';
import { clientInfo } from '#lib/server/auth/request.js';
import { hasRecentStepUp, markStepUp, STEP_UP_WINDOW } from '#lib/server/auth/session.js';
import {
	beginTotpEnrollment,
	confirmTotpEnrollment,
	pendingEnrollment,
	verifyTotp
} from '#lib/server/auth/totp.js';
import { db } from '#lib/server/db/index.js';
import type { Actions, PageServerLoad } from './$types';

const STEP_UP_MESSAGE = 'For your security, verify it’s you first.';

export const load: PageServerLoad = ({ locals }) => {
	const session = locals.session!;
	const { totps } = factorSummary(db(), locals.user!.id);
	return {
		factors: listFactors(db(), locals.user!.id),
		hasTotp: totps > 0,
		recoveryCodesLeft: remainingRecoveryCodes(db(), locals.user!.id),
		stepUpUntil: hasRecentStepUp(session) ? session.stepUpAt! + STEP_UP_WINDOW : null
	};
};

function kindOf(value: FormDataEntryValue | null): FactorKind | null {
	return value === 'passkey' || value === 'totp' ? value : null;
}

function stepUpMissing(event: RequestEvent) {
	return !hasRecentStepUp(event.locals.session!);
}

export const actions: Actions = {
	stepUp: async (event) => {
		const user = event.locals.user!;
		const blocked = mfaAttemptBlocked(event, user);
		if (blocked) return fail(429, { stepUpError: blocked });
		const code = String((await event.request.formData()).get('code') ?? '');
		if (!verifyTotp(db(), user.id, code)) {
			return fail(400, {
				stepUpError: mfaFailed(event, user, 'totp_step_up') ?? 'That code is not correct.'
			});
		}
		markStepUp(db(), event.locals.session!.idHash);
		return { verified: true };
	},

	rename: async (event) => {
		const form = await event.request.formData();
		const kind = kindOf(form.get('kind'));
		const id = String(form.get('id') ?? '');
		if (!kind) return fail(400, { factorError: 'Unknown sign-in method.', factorId: null });
		try {
			const name = renameFactor(
				db(),
				event.locals.user!.id,
				kind,
				id,
				String(form.get('name') ?? '')
			);
			audit(db(), {
				event: 'mfa.factor_renamed',
				actor: event.locals.user,
				target: event.locals.user,
				ip: clientInfo(event).ip,
				detail: { kind, name }
			});
			return { renamed: id };
		} catch (e) {
			if (e instanceof FactorError) return fail(400, { factorError: e.message, factorId: id });
			throw e;
		}
	},

	remove: async (event) => {
		const form = await event.request.formData();
		const kind = kindOf(form.get('kind'));
		const id = String(form.get('id') ?? '');
		if (!kind) return fail(400, { factorError: 'Unknown sign-in method.', factorId: null });
		if (stepUpMissing(event)) {
			return fail(403, { factorError: STEP_UP_MESSAGE, factorId: id, stepUpRequired: true });
		}
		try {
			const factor = removeFactor(db(), event.locals.user!.id, kind, id);
			audit(db(), {
				event: 'mfa.factor_removed',
				actor: event.locals.user,
				target: event.locals.user,
				ip: clientInfo(event).ip,
				detail: { kind, name: factor.name }
			});
			return { removed: id };
		} catch (e) {
			if (e instanceof FactorError) return fail(400, { factorError: e.message, factorId: id });
			throw e;
		}
	},

	totpStart: async (event) => {
		if (stepUpMissing(event)) {
			return fail(403, { totpError: STEP_UP_MESSAGE, stepUpRequired: true });
		}
		const { enrollmentId, secret, qrDataUrl } = await beginTotpEnrollment(db(), event.locals.user!);
		return { enrollment: { enrollmentId, secret, qrDataUrl } };
	},

	totpConfirm: async (event) => {
		const user = event.locals.user!;
		const form = await event.request.formData();
		const enrollmentId = String(form.get('enrollmentId') ?? '');
		if (stepUpMissing(event)) {
			return fail(403, { totpError: STEP_UP_MESSAGE, stepUpRequired: true });
		}
		const result = confirmTotpEnrollment(
			db(),
			user.id,
			enrollmentId,
			String(form.get('code') ?? ''),
			String(form.get('name') ?? '')
		);
		if (!result.ok) {
			const pending = await pendingEnrollment(db(), user, enrollmentId);
			const enrollment = pending && {
				enrollmentId: pending.enrollmentId,
				secret: pending.secret,
				qrDataUrl: pending.qrDataUrl
			};
			return fail(400, { enrollment, totpError: result.error });
		}
		audit(db(), {
			event: 'mfa.totp_enrolled',
			actor: user,
			target: user,
			ip: clientInfo(event).ip
		});
		return { totpAdded: true };
	},

	regenerateRecoveryCodes: async (event) => {
		const { locals } = event;
		if (stepUpMissing(event)) {
			return fail(403, { recoveryError: STEP_UP_MESSAGE, stepUpRequired: true });
		}
		const recoveryCodes = generateRecoveryCodes(db(), locals.user!.id);
		audit(db(), {
			event: 'mfa.recovery_codes_generated',
			actor: locals.user,
			target: locals.user,
			ip: clientInfo(event).ip,
			detail: { regenerated: true }
		});
		return { recoveryCodes };
	}
};
