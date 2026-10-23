import type { z } from 'zod';
import {
	PlexError,
	PlexNotFoundError,
	PlexResponseError,
	PlexUnauthorizedError,
	PlexUnreachableError
} from './errors';

/**
 * The product name sent to Plex. Plex chooses its streaming profile partly by product, and this
 * app relies on the profile of Plex's own web player, so it keeps that name.
 */
export const PLEX_PRODUCT = 'Plex Web';
export const PLEX_VERSION = '0.1.0';
/** Time allowed until response headers arrive; covers unreachable or hung servers. */
export const RESPONSE_TIMEOUT = 5_000;

export type ClientIdentity = {
	/** Stable per-installation identifier (or per playback device). */
	clientIdentifier: string;
	/** Shown in the Plex dashboard, e.g. "Chrome on macOS". */
	deviceName?: string;
	platform?: string;
};

export type Query = Record<string, string | number | boolean | undefined | null>;

export function plexHeaders(identity: ClientIdentity, token?: string | null) {
	const headers: Record<string, string> = {
		Accept: 'application/json',
		'X-Plex-Product': PLEX_PRODUCT,
		'X-Plex-Version': PLEX_VERSION,
		'X-Plex-Client-Identifier': identity.clientIdentifier,
		'X-Plex-Platform': identity.platform ?? 'Web',
		'X-Plex-Device': identity.platform ?? 'Web',
		'X-Plex-Device-Name': identity.deviceName ?? PLEX_PRODUCT,
		'X-Plex-Provides': 'player'
	};
	if (token) headers['X-Plex-Token'] = token;
	return headers;
}

/** Joins `path` onto `base`, keeping any path prefix of `base` (e.g. a proxy or test mount). */
export function buildUrl(base: string, path: string, query?: Query) {
	const url = new URL(base);
	url.pathname = url.pathname.replace(/\/+$/, '') + (path.startsWith('/') ? path : '/' + path);
	for (const [key, value] of Object.entries(query ?? {})) {
		if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
	}
	return url;
}

export type RequestOptions = {
	method?: string;
	query?: Query;
	token?: string | null;
	identity: ClientIdentity;
	body?: BodyInit;
	headers?: Record<string, string>;
	signal?: AbortSignal;
	timeout?: number;
};

/**
 * Sends a request and returns the raw response once headers arrive. Throws typed errors for
 * unreachable servers, 401 and 404; other non-2xx statuses throw {@link PlexError}.
 */
export async function plexFetch(base: string, path: string, options: RequestOptions) {
	const url = buildUrl(base, path, options.query);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), options.timeout ?? RESPONSE_TIMEOUT);
	const onAbort = () => controller.abort();
	options.signal?.addEventListener('abort', onAbort, { once: true });

	let response: Response;
	try {
		response = await fetch(url, {
			method: options.method ?? 'GET',
			headers: { ...plexHeaders(options.identity, options.token), ...options.headers },
			body: options.body,
			signal: controller.signal,
			redirect: 'manual'
		});
	} catch (error) {
		if (options.signal?.aborted) throw error;
		throw new PlexUnreachableError(url.origin, error);
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener('abort', onAbort);
	}

	if (response.ok) return response;
	await response.body?.cancel();
	if (response.status === 401) throw new PlexUnauthorizedError();
	if (response.status === 404) throw new PlexNotFoundError();
	throw new PlexError(`Plex responded with HTTP ${response.status}`, response.status);
}

/** Requests JSON and validates it with `schema`. */
export async function plexJson<S extends z.ZodType>(
	base: string,
	path: string,
	schema: S,
	options: RequestOptions
): Promise<z.output<S>> {
	const response = await plexFetch(base, path, options);
	const text = await response.text();
	let data: unknown;
	try {
		data = text ? JSON.parse(text) : {};
	} catch {
		throw new PlexResponseError(`Plex returned invalid JSON for ${path}`);
	}
	const parsed = schema.safeParse(data);
	if (!parsed.success) {
		throw new PlexResponseError(
			`Unexpected Plex response for ${path}: ${parsed.error.issues
				.slice(0, 3)
				.map((i) => `${i.path.join('.')}: ${i.message}`)
				.join('; ')}`
		);
	}
	return parsed.data;
}

/** Guards identifiers interpolated into PMS paths (rating keys, part ids, section keys). */
export function plexId(value: string | number): string {
	const id = String(value);
	if (!/^\d{1,12}$/.test(id)) throw new PlexNotFoundError('Invalid Plex identifier');
	return id;
}
