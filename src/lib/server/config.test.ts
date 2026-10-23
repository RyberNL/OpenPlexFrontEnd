import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from './config';

const KEY = Buffer.alloc(32, 7).toString('base64');
const valid = { PUBLIC_ORIGIN: 'https://plex.example.com', APP_ENCRYPTION_KEY: KEY };

function issuesFor(env: Record<string, string | undefined>): string[] {
	try {
		parseConfig(env);
	} catch (error) {
		expect(error).toBeInstanceOf(ConfigError);
		return (error as ConfigError).issues;
	}
	throw new Error('expected parseConfig to throw');
}

describe('parseConfig', () => {
	it('accepts a valid configuration and applies defaults', () => {
		const config = parseConfig(valid);
		expect(config.publicOrigin).toBe('https://plex.example.com');
		expect(config.rpId).toBe('plex.example.com');
		expect(config.encryptionKey.length).toBe(32);
		expect(config.plexUrl).toBe('http://127.0.0.1:32400');
		expect(config.dataDir).toBe(path.resolve('./data'));
	});

	it('normalizes a trailing slash on PUBLIC_ORIGIN and PLEX_URL', () => {
		const config = parseConfig({
			...valid,
			PUBLIC_ORIGIN: 'https://plex.example.com/',
			PLEX_URL: 'http://10.0.0.5:32400/'
		});
		expect(config.publicOrigin).toBe('https://plex.example.com');
		expect(config.plexUrl).toBe('http://10.0.0.5:32400');
	});

	it('allows http only for localhost', () => {
		expect(parseConfig({ ...valid, PUBLIC_ORIGIN: 'http://localhost:4173' }).rpId).toBe(
			'localhost'
		);
		expect(issuesFor({ ...valid, PUBLIC_ORIGIN: 'http://plex.example.com' })).toEqual([
			'PUBLIC_ORIGIN must use https:// (http:// is only allowed for localhost)'
		]);
	});

	it('rejects a missing PUBLIC_ORIGIN', () => {
		expect(issuesFor({ APP_ENCRYPTION_KEY: KEY })).toEqual(['PUBLIC_ORIGIN is required']);
	});

	it('rejects a PUBLIC_ORIGIN that is not a URL', () => {
		expect(issuesFor({ ...valid, PUBLIC_ORIGIN: 'plex.example.com' })[0]).toMatch(
			/^PUBLIC_ORIGIN must be an absolute URL/
		);
	});

	it('rejects a PUBLIC_ORIGIN with a path', () => {
		expect(issuesFor({ ...valid, PUBLIC_ORIGIN: 'https://example.com/plex' })).toEqual([
			'PUBLIC_ORIGIN must be an origin only (no path, query or fragment)'
		]);
	});

	it('rejects a missing APP_ENCRYPTION_KEY', () => {
		expect(issuesFor({ PUBLIC_ORIGIN: valid.PUBLIC_ORIGIN })).toEqual([
			'APP_ENCRYPTION_KEY is required'
		]);
	});

	it('rejects an APP_ENCRYPTION_KEY of the wrong length', () => {
		const short = Buffer.alloc(16).toString('base64');
		expect(issuesFor({ ...valid, APP_ENCRYPTION_KEY: short })[0]).toMatch(
			/^APP_ENCRYPTION_KEY must be 32 bytes/
		);
	});

	it('rejects an invalid PLEX_URL', () => {
		expect(issuesFor({ ...valid, PLEX_URL: 'not a url' })[0]).toMatch(/^PLEX_URL must be/);
		expect(issuesFor({ ...valid, PLEX_URL: 'ftp://192.168.1.10' })).toEqual([
			'PLEX_URL must use http:// or https://'
		]);
	});

	it('reports every problem at once', () => {
		expect(issuesFor({})).toEqual(['PUBLIC_ORIGIN is required', 'APP_ENCRYPTION_KEY is required']);
	});

	it('treats empty strings as unset', () => {
		expect(issuesFor({ ...valid, APP_ENCRYPTION_KEY: '' })).toEqual([
			'APP_ENCRYPTION_KEY is required'
		]);
		expect(parseConfig({ ...valid, PLEX_URL: '', DATA_DIR: '' }).plexUrl).toBe(
			'http://127.0.0.1:32400'
		);
	});
});
