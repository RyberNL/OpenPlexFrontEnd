import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import type { DB } from './db';
import { auditLog } from './db/schema';

export const AUDIT_EVENTS = [
	'setup.admin_created',
	'auth.login_succeeded',
	'auth.login_failed',
	'auth.mfa_failed',
	'auth.account_locked',
	'auth.logout',
	'auth.session_revoked',
	'auth.password_changed',
	'mfa.totp_enrolled',
	'mfa.passkey_registered',
	'mfa.factor_renamed',
	'mfa.factor_removed',
	'mfa.recovery_codes_generated',
	'mfa.recovery_code_used',
	'admin.user_created',
	'admin.user_updated',
	'admin.user_disabled',
	'admin.user_enabled',
	'admin.user_deleted',
	'admin.mfa_reset',
	'admin.plex_mapping_changed',
	'admin.plex_linked'
] as const;

export type AuditEvent = (typeof AUDIT_EVENTS)[number];

type Party = { id: string; username: string } | null | undefined;

export type AuditEntry = {
	event: AuditEvent;
	actor?: Party;
	/** Target account; for failed sign-ins of unknown users pass `{ username }` only. */
	target?: Party | { id?: null; username: string };
	ip?: string | null;
	detail?: Record<string, unknown>;
};

/** Events that suggest someone guessing credentials; also written to the server log. */
const AUTH_FAILURES: ReadonlySet<AuditEvent> = new Set([
	'auth.login_failed',
	'auth.mfa_failed',
	'auth.account_locked'
]);

/**
 * The server log line for an authentication failure, for tools like fail2ban: event and source
 * IP only. The attempted username is left out, since it is attacker-controlled text.
 */
export function authFailureLine(entry: Pick<AuditEntry, 'event' | 'ip'>) {
	if (!AUTH_FAILURES.has(entry.event)) return null;
	const ip = entry.ip && /^[\d.:a-fA-F]+$/.test(entry.ip) ? entry.ip : '-';
	return `AUTH_FAILURE event=${entry.event} ip=${ip}`;
}

export function audit(db: DB, entry: AuditEntry, now = Date.now()) {
	const line = authFailureLine(entry);
	if (line && process.env.NODE_ENV !== 'test') console.warn(line);
	db.insert(auditLog)
		.values({
			at: now,
			event: entry.event,
			actorUserId: entry.actor?.id ?? null,
			actorUsername: entry.actor?.username ?? null,
			targetUserId: entry.target?.id ?? null,
			targetUsername: entry.target?.username ?? null,
			ip: entry.ip ?? null,
			detail: entry.detail ?? null
		})
		.run();
}

export type AuditQuery = { userId?: string; event?: string; before?: number; limit?: number };

/** Newest entries first; `before` is an entry id for pagination. */
export function listAudit(db: DB, query: AuditQuery = {}) {
	const conditions: SQL[] = [];
	if (query.userId) {
		conditions.push(
			or(eq(auditLog.actorUserId, query.userId), eq(auditLog.targetUserId, query.userId))!
		);
	}
	if (query.event) conditions.push(eq(auditLog.event, query.event));
	if (query.before) conditions.push(lt(auditLog.id, query.before));
	return db
		.select()
		.from(auditLog)
		.where(conditions.length ? and(...conditions) : undefined)
		.orderBy(desc(auditLog.id))
		.limit(Math.min(query.limit ?? 50, 200))
		.all();
}
