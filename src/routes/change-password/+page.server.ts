import { fail } from '@sveltejs/kit';
import { audit } from '#lib/server/audit.js';
import { hasSecondFactor, setPassword } from '#lib/server/auth/accounts.js';
import { redirectToStep } from '#lib/server/auth/flow.js';
import { passwordPolicyError, verifyPassword } from '#lib/server/auth/password.js';
import { clientInfo, setSession } from '#lib/server/auth/request.js';
import { db } from '#lib/server/db/index.js';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async (event) => {
		const user = event.locals.user!;
		const form = await event.request.formData();
		const password = String(form.get('password') ?? '');
		const confirm = String(form.get('confirm') ?? '');

		const problem = passwordPolicyError(password, user.username);
		if (problem) return fail(400, { error: problem });
		if (password !== confirm) return fail(400, { error: 'The passwords do not match.' });
		if (await verifyPassword(user.passwordHash, password)) {
			return fail(400, { error: 'Choose a password different from the one you were given.' });
		}

		await setPassword(db(), user.id, password);
		audit(db(), {
			event: 'auth.password_changed',
			actor: user,
			target: user,
			ip: clientInfo(event).ip,
			detail: { forced: true }
		});
		const level = hasSecondFactor(db(), user.id) ? 'pending_mfa' : 'pending_mfa_enroll';
		setSession(event, user.id, level);
		redirectToStep(level);
	}
};
