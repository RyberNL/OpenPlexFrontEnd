import { redirect, type RequestEvent } from '@sveltejs/kit';
import { audit } from '../audit';
import { config } from '../config';
import { db } from '../db';
import { safeReturnTo } from './guard';
import { recordSuccess } from './rate-limit';
import { clientInfo, setSession } from './request';
import type { User } from './session';

const RETURN_COOKIE = 'return_to';

/** Remembers where to send the user once authentication completes. */
export function rememberReturnTo(event: RequestEvent, target: string | null) {
	const path = safeReturnTo(target, config().publicOrigin);
	if (path === '/') {
		event.cookies.delete(RETURN_COOKIE, { path: '/' });
		return;
	}
	event.cookies.set(RETURN_COOKIE, path, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: config().publicOrigin.startsWith('https://'),
		maxAge: 15 * 60
	});
}

function consumeReturnTo(event: RequestEvent) {
	const path = safeReturnTo(event.cookies.get(RETURN_COOKIE), config().publicOrigin);
	event.cookies.delete(RETURN_COOKIE, { path: '/' });
	return path;
}

/**
 * Promotes the browser to a fully authenticated session for `user`, resets their failure counter,
 * records the sign-in and returns the post-login destination.
 */
export function completeAuthentication(event: RequestEvent, user: User, method: string) {
	setSession(event, user.id, 'full', { stepUp: true });
	recordSuccess(db(), user.id);
	audit(db(), {
		event: 'auth.login_succeeded',
		actor: user,
		target: user,
		ip: clientInfo(event).ip,
		detail: { method }
	});
	return consumeReturnTo(event);
}

/** Redirects to the next step for a session level reached after the password. */
export function redirectToStep(level: string): never {
	if (level === 'pending_password_change') redirect(303, '/change-password');
	if (level === 'pending_mfa_enroll') redirect(303, '/enroll');
	if (level === 'pending_mfa') redirect(303, '/login/mfa');
	redirect(303, '/');
}

export function lockedMessage(lockedUntil: number, now = Date.now()) {
	const minutes = Math.max(1, Math.ceil((lockedUntil - now) / 60_000));
	return `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}
