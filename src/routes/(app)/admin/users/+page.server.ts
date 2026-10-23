import { fail, redirect } from '@sveltejs/kit';
import { audit } from '#lib/server/audit.js';
import { createUserAsAdmin, listUsers } from '#lib/server/admin/users.js';
import { AccountError } from '#lib/server/auth/accounts.js';
import { clientInfo } from '#lib/server/auth/request.js';
import { db } from '#lib/server/db/index.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ users: listUsers(db()) });

export const actions: Actions = {
	create: async (event) => {
		const form = await event.request.formData();
		const values = {
			username: String(form.get('username') ?? ''),
			displayName: String(form.get('displayName') ?? ''),
			role: form.get('role') === 'admin' ? ('admin' as const) : ('user' as const)
		};
		let user;
		try {
			user = await createUserAsAdmin(db(), {
				...values,
				password: String(form.get('password') ?? '')
			});
		} catch (e) {
			if (e instanceof AccountError) return fail(400, { ...values, createError: e.message });
			throw e;
		}
		audit(db(), {
			event: 'admin.user_created',
			actor: event.locals.user,
			target: user,
			ip: clientInfo(event).ip,
			detail: { role: user.role }
		});
		redirect(303, `/admin/users/${user.id}?created=1`);
	}
};
