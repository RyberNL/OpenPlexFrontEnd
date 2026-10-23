import type { Handle } from '@sveltejs/kit/hooks';
import type { DB } from '../db';
import { guard, isApiPath, isCrossOriginMutation } from './guard';
import { SESSION_COOKIE, validateSession } from './session';

type Deps = { db: () => DB; publicOrigin: () => string };

const SECURITY_HEADERS: Record<string, string> = {
	'x-content-type-options': 'nosniff',
	'x-frame-options': 'DENY',
	'referrer-policy': 'same-origin',
	'permissions-policy': 'camera=(), microphone=(), geolocation=()'
};

/**
 * Builds the authentication `handle` hook: rejects cross-origin mutations, loads the session from
 * its cookie and enforces the route access rules from {@link guard}.
 */
export function createAuthHandle({ db, publicOrigin }: Deps): Handle {
	return async ({ event, resolve }) => {
		const { url, request } = event;
		const api = isApiPath(url.pathname);

		if (isCrossOriginMutation(request.method, request.headers.get('origin'), publicOrigin())) {
			return api
				? Response.json({ message: 'Cross-origin request rejected' }, { status: 403 })
				: new Response('Cross-origin request rejected', { status: 403 });
		}

		const token = event.cookies.get(SESSION_COOKIE) ?? null;
		const result = token ? validateSession(db(), token) : null;
		if (token && !result) event.cookies.delete(SESSION_COOKIE, { path: '/' });
		event.locals.session = result?.session ?? null;
		event.locals.user = result?.user ?? null;
		event.locals.sessionToken = result ? token : null;

		const decision = guard({
			pathname: url.pathname,
			search: url.search,
			session: result?.session ?? null,
			role: result?.user.role ?? null
		});

		if (decision.action === 'redirect') {
			return new Response(null, { status: 303, headers: { location: decision.location } });
		}
		if (decision.action === 'deny') {
			const message = decision.status === 401 ? 'Authentication required' : 'Forbidden';
			return api
				? Response.json({ message }, { status: decision.status })
				: new Response(message, { status: decision.status });
		}

		const response = await resolve(event);
		try {
			for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
				if (!response.headers.has(name)) response.headers.set(name, value);
			}
		} catch {
			// Headers of proxied fetch responses are immutable; those routes set their own.
		}
		return response;
	};
}
