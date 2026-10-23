import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { DB } from '../db';
import { countUsers } from './accounts';

let setupToken: string | null = null;

/**
 * Prepares first-run setup. While no account exists, a one-time setup token is generated (or taken
 * from `SETUP_TOKEN`) and printed to the server log so only someone with server access can create
 * the first admin.
 */
export function prepareSetup(db: DB, publicOrigin: string, env = process.env) {
	if (countUsers(db) > 0) {
		setupToken = null;
		return;
	}
	setupToken = env.SETUP_TOKEN?.trim() || randomBytes(18).toString('base64url');
	console.log(
		[
			'',
			'================ FIRST-RUN SETUP ================',
			`No accounts exist yet. Open ${publicOrigin}/setup`,
			`and enter this setup token: ${setupToken}`,
			'=================================================',
			''
		].join('\n')
	);
}

export function setupOpen(db: DB) {
	return setupToken !== null && countUsers(db) === 0;
}

export function verifySetupToken(candidate: string) {
	if (!setupToken) return false;
	const a = Buffer.from(candidate.trim());
	const b = Buffer.from(setupToken);
	return a.length === b.length && timingSafeEqual(a, b);
}

/** Closes setup permanently for this process once the first admin exists. */
export function closeSetup() {
	setupToken = null;
}
