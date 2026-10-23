import { sql } from 'drizzle-orm';
import { blob, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** Unix epoch milliseconds. */
const timestamp = (name: string) => integer(name, { mode: 'number' });
const createdAt = () =>
	timestamp('created_at')
		.notNull()
		.default(sql`(unixepoch('subsec') * 1000)`);

export const users = sqliteTable(
	'users',
	{
		id: text('id').primaryKey(),
		username: text('username').notNull(),
		displayName: text('display_name').notNull(),
		role: text('role', { enum: ['admin', 'user'] }).notNull(),
		disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
		passwordHash: text('password_hash').notNull(),
		mustChangePassword: integer('must_change_password', { mode: 'boolean' })
			.notNull()
			.default(false),
		/** Random WebAuthn user handle; never the internal id. */
		webauthnUserId: text('webauthn_user_id').notNull(),
		plexHomeUserUuid: text('plex_home_user_uuid'),
		plexHomeUserTitle: text('plex_home_user_title'),
		createdAt: createdAt(),
		updatedAt: timestamp('updated_at')
	},
	(t) => [
		uniqueIndex('users_username_nocase').on(sql`${t.username} COLLATE NOCASE`),
		uniqueIndex('users_webauthn_user_id').on(t.webauthnUserId)
	]
);

export const sessions = sqliteTable(
	'sessions',
	{
		/** SHA-256 of the opaque session id held in the cookie. */
		idHash: text('id_hash').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		level: text('level', {
			enum: ['pending_password_change', 'pending_mfa_enroll', 'pending_mfa', 'full']
		}).notNull(),
		createdAt: createdAt(),
		lastSeenAt: timestamp('last_seen_at').notNull(),
		/** Absolute expiry; idle expiry is derived from lastSeenAt. */
		expiresAt: timestamp('expires_at').notNull(),
		/** Last time a second factor was verified in this session. */
		stepUpAt: timestamp('step_up_at'),
		ip: text('ip'),
		userAgent: text('user_agent')
	},
	(t) => [index('sessions_user').on(t.userId)]
);

export const webauthnCredentials = sqliteTable(
	'webauthn_credentials',
	{
		/** Credential ID, base64url. */
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		publicKey: blob('public_key', { mode: 'buffer' }).notNull(),
		counter: integer('counter').notNull().default(0),
		transports: text('transports', { mode: 'json' }).$type<string[]>(),
		deviceType: text('device_type'),
		backedUp: integer('backed_up', { mode: 'boolean' }).notNull().default(false),
		name: text('name').notNull(),
		createdAt: createdAt(),
		lastUsedAt: timestamp('last_used_at')
	},
	(t) => [index('webauthn_credentials_user').on(t.userId)]
);

export const totpAuthenticators = sqliteTable(
	'totp_authenticators',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		/** Encrypted base32 secret. */
		secretEnc: text('secret_enc').notNull(),
		/** Highest accepted time step, for replay protection. */
		lastUsedStep: integer('last_used_step'),
		createdAt: createdAt(),
		lastUsedAt: timestamp('last_used_at')
	},
	(t) => [index('totp_authenticators_user').on(t.userId)]
);

export const recoveryCodes = sqliteTable(
	'recovery_codes',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		codeHash: text('code_hash').notNull(),
		usedAt: timestamp('used_at'),
		createdAt: createdAt()
	},
	(t) => [index('recovery_codes_user').on(t.userId)]
);

/** One-time WebAuthn challenges and pending TOTP enrollments. */
export const authChallenges = sqliteTable('auth_challenges', {
	id: text('id').primaryKey(),
	purpose: text('purpose', {
		enum: ['webauthn_register', 'webauthn_authenticate', 'webauthn_login', 'totp_enroll']
	}).notNull(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
	sessionHash: text('session_hash'),
	/** WebAuthn challenge, or encrypted TOTP secret for enrollment. */
	value: text('value').notNull(),
	expiresAt: timestamp('expires_at').notNull()
});

export const loginAttempts = sqliteTable('login_attempts', {
	userId: text('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	consecutiveFailures: integer('consecutive_failures').notNull().default(0),
	lockedUntil: timestamp('locked_until')
});

export const auditLog = sqliteTable(
	'audit_log',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		at: createdAt(),
		event: text('event').notNull(),
		actorUserId: text('actor_user_id'),
		actorUsername: text('actor_username'),
		targetUserId: text('target_user_id'),
		targetUsername: text('target_username'),
		ip: text('ip'),
		detail: text('detail', { mode: 'json' }).$type<Record<string, unknown>>()
	},
	(t) => [index('audit_log_at').on(t.at), index('audit_log_event').on(t.event)]
);

/** Singleton row (id = 1) describing the linked Plex server. */
export const plexLink = sqliteTable('plex_link', {
	id: integer('id').primaryKey(),
	serverUrl: text('server_url').notNull(),
	machineIdentifier: text('machine_identifier').notNull(),
	serverName: text('server_name').notNull(),
	serverVersion: text('server_version').notNull(),
	/** Encrypted plex.tv account token of the owner (for plex.tv calls such as Home switching). */
	ownerTokenEnc: text('owner_token_enc').notNull(),
	/** Encrypted server access token of the owner (for PMS calls). */
	ownerServerTokenEnc: text('owner_server_token_enc').notNull(),
	ownerUuid: text('owner_uuid'),
	/** Client identifier used towards plex.tv and PMS for this installation. */
	clientIdentifier: text('client_identifier').notNull(),
	linkedAt: createdAt()
});

/** Cached server access tokens per Plex Home user. */
export const plexHomeTokens = sqliteTable('plex_home_tokens', {
	homeUserUuid: text('home_user_uuid').primaryKey(),
	/** Encrypted Plex Home profile PIN, when the profile is protected. */
	pinEnc: text('pin_enc'),
	serverTokenEnc: text('server_token_enc'),
	updatedAt: timestamp('updated_at')
});

export const userPrefs = sqliteTable('user_prefs', {
	userId: text('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	prefs: text('prefs', { mode: 'json' }).$type<Record<string, unknown>>().notNull()
});

/** Small key/value store for app-wide values such as the Plex client identifier. */
export const appSettings = sqliteTable('app_settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});
