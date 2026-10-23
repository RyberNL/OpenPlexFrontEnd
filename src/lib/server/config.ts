import path from 'node:path';
import { z } from 'zod';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const schema = z.object({
	PUBLIC_ORIGIN: z
		.url({ message: 'must be an absolute URL such as https://plex.example.com' })
		.transform((value) => new URL(value))
		.refine((url) => url.pathname === '/' && !url.search && !url.hash, {
			message: 'must be an origin only (no path, query or fragment)'
		})
		.refine((url) => url.protocol === 'https:' || LOCAL_HOSTS.has(url.hostname), {
			message: 'must use https:// (http:// is only allowed for localhost)'
		})
		.transform((url) => url.origin),
	APP_ENCRYPTION_KEY: z
		.string({ message: 'is required (generate with: openssl rand -base64 32)' })
		.transform((value) => Buffer.from(value, 'base64'))
		.refine((key) => key.length === 32, {
			message: 'must be 32 bytes encoded as base64 (generate with: openssl rand -base64 32)'
		}),
	PLEX_URL: z
		.url({ message: 'must be an absolute URL such as http://192.168.1.10:32400' })
		.pipe(
			z.string().refine((value) => /^https?:$/.test(new URL(value).protocol), {
				message: 'must use http:// or https://'
			})
		)
		.transform((value) => value.replace(/\/+$/, ''))
		.default('http://127.0.0.1:32400'),
	PLEX_TV_URL: z
		.url({ message: 'must be an absolute URL' })
		.transform((value) => value.replace(/\/+$/, ''))
		.default('https://plex.tv'),
	DATA_DIR: z
		.string()
		.min(1)
		.default('./data')
		.transform((value) => path.resolve(value))
});

export type Config = {
	/** Public origin of the app, e.g. `https://plex.example.com`. Passkeys are bound to its hostname. */
	publicOrigin: string;
	/** WebAuthn relying party ID (hostname of {@link publicOrigin}). */
	rpId: string;
	/** 32-byte key for encrypting secrets at rest. */
	encryptionKey: Buffer;
	/** Default Plex Media Server URL suggested when linking. */
	plexUrl: string;
	/** plex.tv base URL (overridable for tests). */
	plexTvUrl: string;
	/** Directory holding the SQLite database. */
	dataDir: string;
};

export class ConfigError extends Error {
	constructor(readonly issues: string[]) {
		super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
		this.name = 'ConfigError';
	}
}

/** Parses and validates configuration from environment variables. Throws {@link ConfigError} listing every problem. */
export function parseConfig(env: Record<string, string | undefined>): Config {
	const result = schema.safeParse({
		PUBLIC_ORIGIN: env.PUBLIC_ORIGIN || undefined,
		APP_ENCRYPTION_KEY: env.APP_ENCRYPTION_KEY || undefined,
		PLEX_URL: env.PLEX_URL || undefined,
		PLEX_TV_URL: env.PLEX_TV_URL || undefined,
		DATA_DIR: env.DATA_DIR || undefined
	});
	if (!result.success) {
		throw new ConfigError(
			result.error.issues.map((issue) => {
				const name = String(issue.path[0]);
				const message =
					issue.code === 'invalid_type' && issue.input === undefined
						? 'is required'
						: issue.message;
				return `${name} ${message}`;
			})
		);
	}
	const data = result.data;
	return {
		publicOrigin: data.PUBLIC_ORIGIN,
		rpId: new URL(data.PUBLIC_ORIGIN).hostname,
		encryptionKey: data.APP_ENCRYPTION_KEY,
		plexUrl: data.PLEX_URL,
		plexTvUrl: data.PLEX_TV_URL,
		dataDir: data.DATA_DIR
	};
}

let cached: Config | undefined;

/** Returns the process configuration, validating it on first use. */
export function config(): Config {
	cached ??= parseConfig(process.env);
	return cached;
}
