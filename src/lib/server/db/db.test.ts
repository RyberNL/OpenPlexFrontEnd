import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './index';

const EXPECTED_TABLES = [
	'app_settings',
	'audit_log',
	'auth_challenges',
	'login_attempts',
	'plex_home_tokens',
	'plex_link',
	'recovery_codes',
	'sessions',
	'totp_authenticators',
	'user_prefs',
	'users',
	'webauthn_credentials'
];

const dirs: string[] = [];
function freshDataDir() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plex-client-db-'));
	dirs.push(dir);
	return path.join(dir, 'nested', 'data');
}

afterEach(() => {
	for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('openDatabase', () => {
	it('creates every table in a fresh data directory', () => {
		const file = path.join(freshDataDir(), 'app.db');
		const db = openDatabase(file);
		const tables = db.$client
			.prepare(
				"select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name"
			)
			.pluck()
			.all();
		expect(tables).toEqual(EXPECTED_TABLES);
		expect(fs.existsSync(file)).toBe(true);
		expect(db.$client.pragma('journal_mode', { simple: true })).toBe('wal');
		expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
		db.$client.close();
	});

	it('is idempotent when reopened', () => {
		const file = path.join(freshDataDir(), 'app.db');
		openDatabase(file).$client.close();
		const db = openDatabase(file);
		const journal = JSON.parse(fs.readFileSync(path.resolve('drizzle/meta/_journal.json'), 'utf8'));
		expect(db.$client.prepare('select count(*) from __drizzle_migrations').pluck().get()).toBe(
			journal.entries.length
		);
		db.$client.close();
	});

	it('enforces case-insensitive unique usernames', () => {
		const db = openDatabase(':memory:');
		const insert = db.$client.prepare(
			"insert into users (id, username, display_name, role, password_hash, webauthn_user_id) values (?, ?, 'x', 'user', 'h', ?)"
		);
		insert.run('1', 'Anna', 'w1');
		expect(() => insert.run('2', 'anna', 'w2')).toThrow(/UNIQUE/);
		db.$client.close();
	});
});
