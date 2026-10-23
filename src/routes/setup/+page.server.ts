import { fail, redirect } from '@sveltejs/kit';
import { audit } from '#lib/server/audit.js';
import { AccountError, createUser } from '#lib/server/auth/accounts.js';
import { clientInfo, setSession } from '#lib/server/auth/request.js';
import { closeSetup, setupOpen, verifySetupToken } from '#lib/server/auth/setup.js';
import { db } from '#lib/server/db/index.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	if (!setupOpen(db())) redirect(303, '/login');
};

export const actions: Actions = {
	default: async (event) => {
		if (!setupOpen(db())) redirect(303, '/login');
		const form = await event.request.formData();
		const token = String(form.get('token') ?? '');
		const username = String(form.get('username') ?? '');
		const displayName = String(form.get('displayName') ?? '');
		const password = String(form.get('password') ?? '');
		const confirm = String(form.get('confirm') ?? '');
		const values = { username, displayName };

		if (!verifySetupToken(token)) {
			return fail(400, {
				...values,
				error: 'The setup token is not correct. Check the server log.'
			});
		}
		if (password !== confirm) {
			return fail(400, { ...values, error: 'The passwords do not match.' });
		}

		let user;
		try {
			user = await createUser(db(), { username, displayName, password, role: 'admin' });
		} catch (error) {
			if (error instanceof AccountError) return fail(400, { ...values, error: error.message });
			throw error;
		}
		closeSetup();
		audit(db(), {
			event: 'setup.admin_created',
			actor: user,
			target: user,
			ip: clientInfo(event).ip
		});
		setSession(event, user.id, 'pending_mfa_enroll');
		redirect(303, '/enroll');
	}
};
