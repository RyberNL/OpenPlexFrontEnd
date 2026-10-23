import { fail, redirect } from '@sveltejs/kit';
import { audit } from '#lib/server/audit.js';
import { setPassword } from '#lib/server/auth/accounts.js';
import { passwordPolicyError, verifyPassword } from '#lib/server/auth/password.js';
import { clearSession, clientInfo } from '#lib/server/auth/request.js';
import {
	listUserSessions,
	revokeUserSession,
	revokeUserSessions
} from '#lib/server/auth/session.js';
import { db } from '#lib/server/db/index.js';
import { describeUserAgent } from '#lib/user-agent.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const current = locals.session!.idHash;
	return {
		username: locals.user!.username,
		sessions: listUserSessions(db(), locals.user!.id).map((s) => ({
			id: s.idHash,
			device: describeUserAgent(s.userAgent),
			ip: s.ip,
			createdAt: s.createdAt,
			lastSeenAt: s.lastSeenAt,
			current: s.idHash === current
		}))
	};
};

export const actions: Actions = {
	revoke: async (event) => {
		const { locals } = event;
		const id = String((await event.request.formData()).get('id') ?? '');
		if (!revokeUserSession(db(), locals.user!.id, id)) {
			return fail(404, { revokeError: 'That session no longer exists.' });
		}
		audit(db(), {
			event: 'auth.session_revoked',
			actor: locals.user,
			target: locals.user,
			ip: clientInfo(event).ip
		});
		if (id === locals.session!.idHash) {
			clearSession(event);
			redirect(303, '/login');
		}
		return { revoked: true };
	},

	password: async (event) => {
		const user = event.locals.user!;
		const form = await event.request.formData();
		const current = String(form.get('current') ?? '');
		const password = String(form.get('password') ?? '');
		const confirm = String(form.get('confirm') ?? '');

		if (!(await verifyPassword(user.passwordHash, current))) {
			return fail(400, { passwordError: 'Your current password is not correct.' });
		}
		const problem = passwordPolicyError(password, user.username);
		if (problem) return fail(400, { passwordError: problem });
		if (password !== confirm) return fail(400, { passwordError: 'The passwords do not match.' });

		await setPassword(db(), user.id, password);
		revokeUserSessions(db(), user.id, event.locals.session!.idHash);
		audit(db(), {
			event: 'auth.password_changed',
			actor: user,
			target: user,
			ip: clientInfo(event).ip
		});
		return { passwordChanged: true };
	}
};
