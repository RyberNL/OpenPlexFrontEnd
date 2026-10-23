import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '../db';
import { insertUser, testDb } from '../test-utils';
import { safeReturnTo } from './guard';
import { createAuthHandle } from './handle';
import { createSession, SESSION_COOKIE, type SessionLevel } from './session';

const ORIGIN = 'https://plex.example.com';

let db: DB;
let handle: ReturnType<typeof createAuthHandle>;

beforeEach(() => {
	db = testDb();
	handle = createAuthHandle({ db: () => db, publicOrigin: () => ORIGIN });
});

function sessionFor(level: SessionLevel, role: 'admin' | 'user' = 'user') {
	const user = insertUser(db, { role });
	return createSession(db, user.id, level).token;
}

async function request(
	path: string,
	options: { method?: string; origin?: string | null; token?: string } = {}
) {
	const url = new URL(path, ORIGIN);
	const headers = new Headers();
	const origin = options.origin === undefined ? ORIGIN : options.origin;
	if (origin) headers.set('origin', origin);
	const cookies = new Map<string, string>();
	if (options.token) cookies.set(SESSION_COOKIE, options.token);
	const event = {
		url,
		request: new Request(url, { method: options.method ?? 'GET', headers }),
		cookies: {
			get: (name: string) => cookies.get(name),
			delete: (name: string) => cookies.delete(name)
		},
		locals: {}
	} as unknown as RequestEvent;
	let resolved = false;
	const response = await handle({
		event,
		resolve: async () => {
			resolved = true;
			return new Response('ok');
		}
	});
	return { response, resolved, locals: event.locals, cookies };
}

describe('auth handle', () => {
	it('redirects signed-out page requests to sign-in with a return target', async () => {
		const { response, resolved } = await request('/item/42?tab=cast');
		expect(resolved).toBe(false);
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/login?returnTo=%2Fitem%2F42%3Ftab%3Dcast');
	});

	it('answers signed-out API requests with 401 JSON', async () => {
		const { response } = await request('/api/libraries');
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ message: 'Authentication required' });
	});

	it('treats relayed images and streams as API routes', async () => {
		expect((await request('/img/abc')).response.status).toBe(401);
		expect((await request('/stream/abc/master.m3u8')).response.status).toBe(401);
	});

	it('lets public pages through without a session', async () => {
		expect((await request('/login')).resolved).toBe(true);
		expect((await request('/setup')).resolved).toBe(true);
		expect((await request('/healthz')).resolved).toBe(true);
	});

	it('loads a full session and allows app pages', async () => {
		const { resolved, locals, response } = await request('/', { token: sessionFor('full') });
		expect(resolved).toBe(true);
		expect(locals.user).not.toBeNull();
		expect(locals.session?.level).toBe('full');
		expect(response.headers.get('x-frame-options')).toBe('DENY');
	});

	it('sends signed-in users away from the sign-in page', async () => {
		const { response } = await request('/login', { token: sessionFor('full') });
		expect(response.headers.get('location')).toBe('/');
	});

	it('keeps a pending-MFA session on the MFA step', async () => {
		const token = sessionFor('pending_mfa');
		expect((await request('/', { token })).response.headers.get('location')).toBe('/login/mfa');
		expect((await request('/settings', { token })).response.headers.get('location')).toBe(
			'/login/mfa'
		);
		expect((await request('/api/libraries', { token })).response.status).toBe(401);
		expect((await request('/login/mfa', { token })).resolved).toBe(true);
		expect((await request('/api/auth/mfa/passkey', { token })).resolved).toBe(true);
	});

	it('sends users without a factor to enrollment and password changes first', async () => {
		const enroll = sessionFor('pending_mfa_enroll');
		expect((await request('/', { token: enroll })).response.headers.get('location')).toBe(
			'/enroll'
		);
		expect((await request('/api/auth/enroll/totp', { token: enroll })).resolved).toBe(true);
		const change = sessionFor('pending_password_change');
		expect((await request('/enroll', { token: change })).response.headers.get('location')).toBe(
			'/change-password'
		);
	});

	it('does not let full sessions revisit pending steps', async () => {
		const { response } = await request('/login/mfa', { token: sessionFor('full') });
		expect(response.headers.get('location')).toBe('/');
	});

	it('allows sign-out from any session level', async () => {
		expect(
			(await request('/logout', { method: 'POST', token: sessionFor('pending_mfa') })).resolved
		).toBe(true);
	});

	it('returns 403 for admin routes to regular users', async () => {
		const { response } = await request('/admin/users', { token: sessionFor('full') });
		expect(response.status).toBe(403);
		expect((await request('/api/admin/users', { token: sessionFor('full') })).response.status).toBe(
			403
		);
		expect((await request('/admin/users', { token: sessionFor('full', 'admin') })).resolved).toBe(
			true
		);
	});

	it('clears an invalid session cookie', async () => {
		const { cookies, response } = await request('/', { token: 'forged-token' });
		expect(response.status).toBe(303);
		expect(cookies.has(SESSION_COOKIE)).toBe(false);
	});

	it('rejects cross-origin state-changing requests with 403', async () => {
		const token = sessionFor('full');
		const { response, resolved } = await request('/logout', {
			method: 'POST',
			origin: 'https://evil.example',
			token
		});
		expect(response.status).toBe(403);
		expect(resolved).toBe(false);
		// The session is unaffected.
		expect((await request('/', { token })).resolved).toBe(true);
	});

	it('rejects state-changing requests without an Origin header', async () => {
		const { response } = await request('/logout', { method: 'POST', origin: null });
		expect(response.status).toBe(403);
	});

	it('allows same-origin POSTs and cross-origin GETs', async () => {
		const token = sessionFor('full');
		expect((await request('/logout', { method: 'POST', token })).resolved).toBe(true);
		expect(
			(await request('/', { origin: 'https://evil.example', token: sessionFor('full') })).resolved
		).toBe(true);
	});
});

describe('safeReturnTo', () => {
	it.each([
		['/item/42?x=1#cast', '/item/42?x=1#cast'],
		['https://evil.example/phish', '/'],
		['//evil.example/phish', '/'],
		['/\\evil.example', '/'],
		['javascript:alert(1)', '/'],
		['', '/'],
		[null, '/']
	])('%s → %s', (input, expected) => {
		expect(safeReturnTo(input, ORIGIN)).toBe(expected);
	});
});
