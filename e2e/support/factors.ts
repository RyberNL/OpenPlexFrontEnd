import { createHash, randomUUID } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import { encrypt, keyring } from '../../src/lib/server/crypto';
import { e2eDb } from './db';

/** Same key the e2e server is started with (see playwright.config.ts). */
const ring = keyring(Buffer.alloc(32, 1));

/** Gives a seeded user a TOTP authenticator and returns a generator for valid codes. */
export function seedTotp(userId: string) {
	const secret = new Secret({ size: 20 });
	const db = e2eDb();
	db.prepare(
		'insert into totp_authenticators (id, user_id, name, secret_enc) values (?, ?, ?, ?)'
	).run(randomUUID(), userId, 'Authenticator app', encrypt(secret.base32, `totp:${userId}`, ring));
	db.close();
	return totpFor(secret.base32);
}

export function totpFor(base32: string) {
	return new TOTP({ secret: Secret.fromBase32(base32), digits: 6, period: 30, algorithm: 'SHA1' });
}

/** Gives a user a fresh set of recovery codes and returns them. */
export function seedRecoveryCodes(userId: string) {
	const codes = Array.from(
		{ length: 10 },
		(_, i) => `TEST${i}-${randomUUID().slice(0, 5).toUpperCase()}`
	);
	const db = e2eDb();
	const insert = db.prepare('insert into recovery_codes (id, user_id, code_hash) values (?, ?, ?)');
	for (const code of codes) {
		const normalized = code.toUpperCase().replace(/[^0-9A-Z]/g, '');
		insert.run(randomUUID(), userId, createHash('sha256').update(normalized).digest('hex'));
	}
	db.close();
	return codes;
}
