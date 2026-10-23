import { fail } from '@sveltejs/kit';
import { audit } from '#lib/server/audit.js';
import { findUserByUsername, levelAfterPassword } from '#lib/server/auth/accounts.js';
import { lockedMessage, redirectToStep, rememberReturnTo } from '#lib/server/auth/flow.js';
import { verifyPassword } from '#lib/server/auth/password.js';
import { accountLockedUntil, ipLimiter, recordFailure } from '#lib/server/auth/rate-limit.js';
import { clientInfo, setSession } from '#lib/server/auth/request.js';
import { setupOpen } from '#lib/server/auth/setup.js';
import { db } from '#lib/server/db/index.js';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const INVALID = 'Invalid username or password.';

export const load: PageServerLoad = ({ url }) => {
	if (setupOpen(db())) redirect(303, '/setup');
	return { returnTo: url.searchParams.get('returnTo') ?? '' };
};

export const actions: Actions = {
	default: async (event) => {
		const form = await event.request.formData();
		const username = String(form.get('username') ?? '').trim();
		const password = String(form.get('password') ?? '');
		const returnTo = String(form.get('returnTo') ?? '');
		const { ip } = clientInfo(event);

		if (!ipLimiter.attempt(ip ?? 'unknown')) {
			const minutes = Math.ceil(ipLimiter.retryAfter(ip ?? 'unknown') / 60_000);
			return fail(429, {
				username,
				error: `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
			});
		}

		const user = username ? findUserByUsername(db(), username) : undefined;
		const lockedUntil = user ? accountLockedUntil(db(), user.id) : null;
		if (user && lockedUntil) {
			audit(db(), {
				event: 'auth.login_failed',
				target: user,
				ip,
				detail: { reason: 'locked' }
			});
			return fail(429, { username, error: lockedMessage(lockedUntil) });
		}

		const valid = await verifyPassword(user?.passwordHash ?? null, password);
		if (!user || !valid) {
			audit(db(), {
				event: 'auth.login_failed',
				target: user ?? { username },
				ip,
				detail: { reason: user ? 'wrong_password' : 'unknown_user' }
			});
			if (user) {
				const result = recordFailure(db(), user.id);
				if (result.locked) {
					audit(db(), { event: 'auth.account_locked', target: user, ip });
					return fail(429, { username, error: lockedMessage(result.lockedUntil) });
				}
			}
			return fail(400, { username, error: INVALID });
		}

		if (user.disabled) {
			audit(db(), {
				event: 'auth.login_failed',
				target: user,
				ip,
				detail: { reason: 'disabled' }
			});
			return fail(403, { username, error: 'This account has been disabled.' });
		}

		const level = levelAfterPassword(db(), user);
		setSession(event, user.id, level);
		rememberReturnTo(event, returnTo);
		redirectToStep(level);
	}
};
