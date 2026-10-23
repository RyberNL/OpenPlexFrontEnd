import type { SessionLevel } from './session';

type Rule = {
	prefix: string;
	/** Session levels allowed; 'public' needs no session at all. */
	access: 'public' | 'any-session' | SessionLevel[];
	admin?: boolean;
	/** Public pages that a fully signed-in user should skip (e.g. the sign-in page). */
	redirectWhenSignedIn?: boolean;
};

/** Ordered: the first rule whose prefix matches wins. Unmatched paths require a full session. */
const RULES: Rule[] = [
	{ prefix: '/login/mfa', access: ['pending_mfa'] },
	{ prefix: '/login', access: 'public', redirectWhenSignedIn: true },
	{ prefix: '/setup', access: 'public', redirectWhenSignedIn: true },
	{ prefix: '/healthz', access: 'public' },
	{ prefix: '/manifest.webmanifest', access: 'public' },
	{ prefix: '/api/auth/passkey-login', access: 'public' },
	{ prefix: '/api/auth/mfa', access: ['pending_mfa', 'full'] },
	{ prefix: '/api/auth/enroll', access: ['pending_mfa_enroll', 'full'] },
	{ prefix: '/change-password', access: ['pending_password_change'] },
	{ prefix: '/enroll', access: ['pending_mfa_enroll'] },
	{ prefix: '/logout', access: 'any-session' },
	{ prefix: '/admin', access: ['full'], admin: true },
	{ prefix: '/api/admin', access: ['full'], admin: true }
];

/** Where a session at a pending level must go next. */
export const PENDING_STEP: Record<Exclude<SessionLevel, 'full'>, string> = {
	pending_password_change: '/change-password',
	pending_mfa_enroll: '/enroll',
	pending_mfa: '/login/mfa'
};

function matches(pathname: string, prefix: string) {
	return pathname === prefix || pathname.startsWith(prefix + '/');
}

export function isApiPath(pathname: string) {
	return matches(pathname, '/api') || matches(pathname, '/img') || matches(pathname, '/stream');
}

export type GuardInput = {
	pathname: string;
	search: string;
	session: { level: SessionLevel } | null;
	role: 'admin' | 'user' | null;
};

export type GuardDecision =
	| { action: 'allow' }
	| { action: 'redirect'; location: string }
	| { action: 'deny'; status: 401 | 403 };

/** Decides whether a request may proceed based on the path and the caller's session. */
export function guard({ pathname, search, session, role }: GuardInput): GuardDecision {
	const rule = RULES.find((r) => matches(pathname, r.prefix));
	const api = isApiPath(pathname);

	if (rule?.access === 'public') {
		if (rule.redirectWhenSignedIn && session?.level === 'full' && !api) {
			return { action: 'redirect', location: '/' };
		}
		return { action: 'allow' };
	}

	if (!session) {
		if (api) return { action: 'deny', status: 401 };
		return { action: 'redirect', location: loginUrl(pathname + search) };
	}

	if (rule?.access === 'any-session') return { action: 'allow' };

	const allowed = rule?.access ?? ['full'];
	if (!allowed.includes(session.level)) {
		if (api) return { action: 'deny', status: 401 };
		const location = session.level === 'full' ? '/' : PENDING_STEP[session.level];
		return { action: 'redirect', location };
	}

	if (rule?.admin && role !== 'admin') return { action: 'deny', status: 403 };
	return { action: 'allow' };
}

function loginUrl(returnTo: string) {
	return returnTo === '/' ? '/login' : `/login?returnTo=${encodeURIComponent(returnTo)}`;
}

/**
 * Returns `target` if it is a same-origin path, otherwise `/`. Prevents open redirects through
 * `returnTo` parameters.
 */
export function safeReturnTo(target: string | null | undefined, origin: string) {
	if (!target || !target.startsWith('/') || target.startsWith('//') || target.includes('\\')) {
		return '/';
	}
	try {
		const url = new URL(target, origin);
		if (url.origin !== origin) return '/';
		return url.pathname + url.search + url.hash;
	} catch {
		return '/';
	}
}

/** State-changing requests must come from our own origin. */
export function isCrossOriginMutation(method: string, origin: string | null, publicOrigin: string) {
	if (method === 'GET' || method === 'HEAD') return false;
	return origin !== publicOrigin;
}
