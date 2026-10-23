import { randomBytes } from 'node:crypto';
import { eq, isNotNull } from 'drizzle-orm';
import { resetMfa } from '../admin/users';
import { audit } from '../audit';
import { createUser, findUserByUsername } from '../auth/accounts';
import { decrypt, encrypt, keyring, keyVersion, singleKeyring } from '../crypto';
import { contexts } from '../crypto-contexts';
import type { DB } from '../db';
import { authChallenges, plexHomeTokens, plexLink, totpAuthenticators } from '../db/schema';

export class CliError extends Error {}

type Output = (line: string) => void;

/**
 * Creates an administrator with a random temporary password, which they must change at first
 * sign-in (followed by two-factor setup).
 */
export async function createAdmin(db: DB, username: string, out: Output, displayName?: string) {
	if (!username) throw new CliError('Usage: create-admin <username> [display name]');
	const password = randomBytes(12).toString('base64url');
	const user = await createUser(db, {
		username,
		displayName: displayName ?? username,
		role: 'admin',
		password,
		mustChangePassword: true
	}).catch((e: Error) => {
		throw new CliError(e.message);
	});
	audit(db, { event: 'admin.user_created', target: user, detail: { via: 'cli', role: 'admin' } });
	out(`Created administrator "${user.username}".`);
	out(`Temporary password: ${password}`);
	out('They must choose a new password and set up two-factor authentication at first sign-in.');
	return { user, password };
}

/** Removes all of a user's two-factor methods and recovery codes and signs them out everywhere. */
export function resetMfaCommand(db: DB, username: string, out: Output) {
	if (!username) throw new CliError('Usage: reset-mfa <username>');
	const user = findUserByUsername(db, username);
	if (!user) throw new CliError(`No user named "${username}".`);
	resetMfa(db, user.id);
	audit(db, { event: 'admin.mfa_reset', target: user, detail: { via: 'cli' } });
	out(`Two-factor authentication reset for "${user.username}".`);
	out('They can sign in with their password and will be asked to set it up again.');
}

/**
 * Re-encrypts every secret from `oldKey` to the current key. Run after changing
 * APP_ENCRYPTION_KEY, passing the previous key.
 */
export function rotateKey(db: DB, oldKey: Buffer, newKey: Buffer, out: Output) {
	if (oldKey.length !== 32) throw new CliError('The old key must be 32 bytes, base64-encoded.');
	if (oldKey.equals(newKey)) throw new CliError('The old and new keys are the same.');

	// Values may already carry any version; the new key always gets the next version number.
	const versions = new Set<number>();
	const collect = (value: string | null) => {
		const v = value ? keyVersion(value) : undefined;
		if (v !== undefined) versions.add(v);
	};

	const totps = db.select().from(totpAuthenticators).all();
	const enrollments = db
		.select()
		.from(authChallenges)
		.where(eq(authChallenges.purpose, 'totp_enroll'))
		.all();
	const link = db.select().from(plexLink).get();
	const homes = db.select().from(plexHomeTokens).all();
	totps.forEach((t) => collect(t.secretEnc));
	enrollments.forEach((c) => collect(c.value));
	collect(link?.ownerTokenEnc ?? null);
	collect(link?.ownerServerTokenEnc ?? null);
	homes.forEach((h) => {
		collect(h.serverTokenEnc);
		collect(h.pinEnc);
	});

	const current = Math.max(0, ...versions);
	const oldRing = singleKeyring(oldKey, current);
	const newRing = keyring(newKey, current + 1);
	const reencrypt = (value: string, context: string) =>
		encrypt(decrypt(value, context, oldRing), context, newRing);

	let count = 0;
	try {
		db.transaction((tx) => {
			for (const t of totps) {
				tx.update(totpAuthenticators)
					.set({ secretEnc: reencrypt(t.secretEnc, contexts.totpSecret(t.userId)) })
					.where(eq(totpAuthenticators.id, t.id))
					.run();
				count++;
			}
			for (const c of enrollments) {
				tx.update(authChallenges)
					.set({ value: reencrypt(c.value, contexts.totpEnrollment(c.userId!)) })
					.where(eq(authChallenges.id, c.id))
					.run();
				count++;
			}
			if (link) {
				tx.update(plexLink)
					.set({
						ownerTokenEnc: reencrypt(link.ownerTokenEnc, contexts.plexOwnerToken()),
						ownerServerTokenEnc: reencrypt(
							link.ownerServerTokenEnc,
							contexts.plexOwnerServerToken()
						)
					})
					.where(isNotNull(plexLink.id))
					.run();
				count += 2;
			}
			for (const h of homes) {
				tx.update(plexHomeTokens)
					.set({
						serverTokenEnc: h.serverTokenEnc
							? reencrypt(h.serverTokenEnc, contexts.plexHomeToken(h.homeUserUuid))
							: null,
						pinEnc: h.pinEnc ? reencrypt(h.pinEnc, contexts.plexHomePin(h.homeUserUuid)) : null
					})
					.where(eq(plexHomeTokens.homeUserUuid, h.homeUserUuid))
					.run();
				count += (h.serverTokenEnc ? 1 : 0) + (h.pinEnc ? 1 : 0);
			}
		});
	} catch (e) {
		throw new CliError(
			`Rotation aborted, nothing was changed: ${(e as Error).message}. Is --old-key the key the data was encrypted with?`
		);
	}
	out(
		`Re-encrypted ${count} secret${count === 1 ? '' : 's'} with the new key (version ${current + 1}).`
	);
	return count;
}
