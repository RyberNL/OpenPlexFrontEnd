import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { hash } from '@node-rs/argon2';
import Database from 'better-sqlite3';

/** Direct access to the e2e server's database for seeding and assertions. */
export function e2eDb() {
	const db = new Database(path.resolve('.e2e-data/app.db'));
	db.pragma('busy_timeout = 5000');
	return db;
}

export const DEFAULT_PASSWORD = 'correct horse battery staple';

export type SeedUser = {
	id: string;
	username: string;
	password: string;
};

/** Inserts a user directly. Each call gets a unique username unless one is given. */
export async function seedUser(
	options: {
		username?: string;
		password?: string;
		role?: 'admin' | 'user';
		mustChangePassword?: boolean;
		disabled?: boolean;
	} = {}
): Promise<SeedUser> {
	const id = randomUUID();
	const username = options.username ?? `u${randomBytes(4).toString('hex')}`;
	const password = options.password ?? DEFAULT_PASSWORD;
	const db = e2eDb();
	db.prepare(
		`insert into users (id, username, display_name, role, disabled, password_hash, must_change_password, webauthn_user_id, updated_at)
		 values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		id,
		username,
		username,
		options.role ?? 'user',
		options.disabled ? 1 : 0,
		await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
		options.mustChangePassword ? 1 : 0,
		randomBytes(32).toString('base64url'),
		Date.now()
	);
	db.close();
	return { id, username, password };
}

export function countUsers() {
	const db = e2eDb();
	const n = db.prepare('select count(*) from users').pluck().get() as number;
	db.close();
	return n;
}

/** Creates a session row directly and returns its cookie token. */
export function seedSession(
	userId: string,
	level: 'full' | 'pending_mfa' | 'pending_mfa_enroll' | 'pending_password_change' = 'full',
	userAgent = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0 Safari/537.36',
	/** How long ago a second factor was last verified (null: never). */
	stepUpAgoMs: number | null = 0
) {
	const token = randomBytes(32).toString('base64url');
	const now = Date.now();
	const stepUpAt = stepUpAgoMs === null ? null : now - stepUpAgoMs;
	const db = e2eDb();
	db.prepare(
		`insert into sessions (id_hash, user_id, level, created_at, last_seen_at, expires_at, step_up_at, ip, user_agent)
		 values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		createHash('sha256').update(token).digest('hex'),
		userId,
		level,
		now,
		now,
		now + 30 * 86_400_000,
		stepUpAt,
		'127.0.0.1',
		userAgent
	);
	db.close();
	return token;
}

/** Maps a seeded user to the (fake) Plex owner, like an admin choosing the owner in the UI. */
export function mapToPlexOwner(userId: string) {
	const db = e2eDb();
	const ownerUuid = db.prepare('select owner_uuid from plex_link where id = 1').pluck().get();
	db.prepare(
		"update users set plex_home_user_uuid = ?, plex_home_user_title = 'Owner' where id = ?"
	).run(ownerUuid, userId);
	db.close();
}

/** Stores playback preferences for a user, like saving them in Settings. */
export function setPrefs(userId: string, prefs: Record<string, unknown>) {
	const db = e2eDb();
	db.prepare(
		'insert into user_prefs (user_id, prefs) values (?, ?) on conflict(user_id) do update set prefs = excluded.prefs'
	).run(userId, JSON.stringify(prefs));
	db.close();
}
