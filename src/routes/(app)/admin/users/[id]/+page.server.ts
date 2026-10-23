import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { audit, type AuditEvent } from '#lib/server/audit.js';
import {
	AdminError,
	deleteUser,
	listUsers,
	resetMfa,
	setDisabled,
	updateUser
} from '#lib/server/admin/users.js';
import { clientInfo } from '#lib/server/auth/request.js';
import type { User } from '#lib/server/auth/session.js';
import { db } from '#lib/server/db/index.js';
import { HomeUserError, listHomeUsers, mapUser, type HomeUser } from '#lib/server/plex/home.js';
import { linkedServer } from '#lib/server/plex/link.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const user = listUsers(db()).find((u) => u.id === params.id);
	if (!user) error(404, 'User not found');

	let homeUsers: HomeUser[] = [];
	let homeUsersError: string | null = null;
	const linked = !!linkedServer(db());
	if (linked) {
		try {
			homeUsers = await listHomeUsers(db());
		} catch {
			homeUsersError = 'Could not load Plex Home users from plex.tv. Try again later.';
		}
	}
	return {
		user,
		linked,
		homeUsers,
		homeUsersError,
		isSelf: user.id === locals.user!.id,
		created: url.searchParams.has('created')
	};
};

function record(
	event: RequestEvent,
	type: AuditEvent,
	target: Pick<User, 'id' | 'username'>,
	detail?: Record<string, unknown>
) {
	audit(db(), {
		event: type,
		actor: event.locals.user,
		target,
		ip: clientInfo(event).ip,
		detail
	});
}

/** Runs an admin operation, turning refusals into a form error. */
function attempt<T>(fn: () => T): T | ReturnType<typeof fail<{ error: string }>> {
	try {
		return fn();
	} catch (e) {
		if (e instanceof AdminError) return fail(400, { error: e.message });
		throw e;
	}
}

export const actions: Actions = {
	update: async (event) => {
		const form = await event.request.formData();
		const role = form.get('role') === 'admin' ? ('admin' as const) : ('user' as const);
		const result = attempt(() =>
			updateUser(db(), event.locals.user!.id, event.params.id, {
				displayName: String(form.get('displayName') ?? ''),
				role
			})
		);
		if ('status' in result) return result;
		record(event, 'admin.user_updated', result, { role });
		return { saved: true };
	},

	disable: async (event) => {
		const result = attempt(() => setDisabled(db(), event.locals.user!.id, event.params.id, true));
		if ('status' in result) return result;
		record(event, 'admin.user_disabled', result);
		return { disabled: true };
	},

	enable: async (event) => {
		const result = attempt(() => setDisabled(db(), event.locals.user!.id, event.params.id, false));
		if ('status' in result) return result;
		record(event, 'admin.user_enabled', result);
		return { enabled: true };
	},

	resetMfa: async (event) => {
		const result = attempt(() => resetMfa(db(), event.params.id));
		if ('status' in result) return result;
		record(event, 'admin.mfa_reset', result);
		return { mfaReset: true };
	},

	mapPlex: async (event) => {
		const form = await event.request.formData();
		const homeUuid = String(form.get('homeUser') ?? '') || null;
		const pin = String(form.get('pin') ?? '').trim() || null;
		let homeUser;
		try {
			homeUser = await mapUser(db(), event.params.id, homeUuid, pin);
		} catch (e) {
			if (e instanceof HomeUserError) return fail(400, { plexError: e.message });
			throw e;
		}
		const target = listUsers(db()).find((u) => u.id === event.params.id)!;
		record(event, 'admin.plex_mapping_changed', target, {
			plexHomeUser: homeUser?.title ?? null
		});
		return { plexMapped: homeUser?.title ?? null, plexCleared: !homeUser };
	},

	delete: async (event) => {
		const result = attempt(() => deleteUser(db(), event.locals.user!.id, event.params.id));
		if ('status' in result) return result;
		record(event, 'admin.user_deleted', result);
		redirect(303, '/admin/users');
	}
};
