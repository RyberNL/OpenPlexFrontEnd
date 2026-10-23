import type { RequestEvent } from '@sveltejs/kit';
import { audit } from '../audit';
import { db } from '../db';
import { lockedMessage } from './flow';
import { accountLockedUntil, ipLimiter, recordFailure } from './rate-limit';
import { clientInfo } from './request';
import type { User } from './session';

/** Checks rate limits before a second-factor attempt. Returns a user-facing error or null. */
export function mfaAttemptBlocked(event: RequestEvent, user: User): string | null {
	const ip = clientInfo(event).ip ?? 'unknown';
	if (!ipLimiter.attempt(ip)) {
		const minutes = Math.ceil(ipLimiter.retryAfter(ip) / 60_000);
		return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
	}
	const lockedUntil = accountLockedUntil(db(), user.id);
	return lockedUntil ? lockedMessage(lockedUntil) : null;
}

/** Records a failed second-factor attempt; returns the lockout message if it locked the account. */
export function mfaFailed(event: RequestEvent, user: User, method: string): string | null {
	const ip = clientInfo(event).ip;
	audit(db(), { event: 'auth.mfa_failed', target: user, ip, detail: { method } });
	const result = recordFailure(db(), user.id);
	if (result.locked) {
		audit(db(), { event: 'auth.account_locked', target: user, ip });
		return lockedMessage(result.lockedUntil);
	}
	return null;
}
