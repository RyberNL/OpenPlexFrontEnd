import type { RequestEvent } from '@sveltejs/kit';
import { config } from '../config';
import { db } from '../db';
import {
	createSession,
	revokeSession,
	rotateSession,
	SESSION_COOKIE,
	sessionCookieOptions,
	type Session,
	type SessionLevel
} from './session';

export function clientInfo(event: RequestEvent) {
	let ip: string | null = null;
	try {
		ip = event.getClientAddress();
	} catch {
		// Not available in some contexts (e.g. prerendering).
	}
	return { ip, userAgent: event.request.headers.get('user-agent') };
}

function adopt(event: RequestEvent, token: string, session: Session) {
	const secure = config().publicOrigin.startsWith('https://');
	event.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(secure, session.level));
	event.locals.session = session;
	event.locals.sessionToken = token;
	return session;
}

/**
 * Puts the request's browser into a session for `userId` at `level`, always under a fresh
 * identifier. An existing session of the same user is rotated; any other session is discarded.
 */
export function setSession(
	event: RequestEvent,
	userId: string,
	level: SessionLevel,
	options: { stepUp?: boolean } = {}
) {
	const current = event.locals.session;
	if (current && current.userId === userId) {
		const { token, session } = rotateSession(db(), current, level, options);
		return adopt(event, token, session);
	}
	if (current) revokeSession(db(), current.idHash);
	const { token, session } = createSession(db(), userId, level, clientInfo(event), options);
	return adopt(event, token, session);
}

export function clearSession(event: RequestEvent) {
	if (event.locals.session) revokeSession(db(), event.locals.session.idHash);
	event.cookies.delete(SESSION_COOKIE, { path: '/' });
	event.locals.session = null;
	event.locals.user = null;
	event.locals.sessionToken = null;
}
