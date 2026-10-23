import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from './config';

const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Keys by version. New values are encrypted with version `current`; `key` resolves the key for
 * the version stored in a value.
 */
export type Keyring = { current: number; key: (version: number) => Buffer | undefined };

export class DecryptionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DecryptionError';
	}
}

/** A keyring holding a single key for exactly one version. */
export function keyring(key: Buffer, version = 1): Keyring {
	return { current: version, key: (v) => (v === version ? key : undefined) };
}

/**
 * The running app holds one key and uses it for every version label: after `rotate-key` stored
 * values carry a higher version, all encrypted with the configured key.
 */
export function singleKeyring(key: Buffer, current = 1): Keyring {
	return { current, key: () => key };
}

/**
 * Encrypts a UTF-8 string. Output format: `v<version>.<nonce>.<ciphertext>.<tag>`, base64url parts.
 * `context` is bound as additional authenticated data so a value cannot be moved to another field.
 */
export function encrypt(plaintext: string, context: string, ring: Keyring = defaultKeyring()) {
	const key = ring.key(ring.current);
	if (!key) throw new Error(`No key for version ${ring.current}`);
	const nonce = randomBytes(NONCE_BYTES);
	const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
	cipher.setAAD(Buffer.from(context));
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	return [
		`v${ring.current}`,
		nonce.toString('base64url'),
		ciphertext.toString('base64url'),
		cipher.getAuthTag().toString('base64url')
	].join('.');
}

/** Decrypts a value produced by {@link encrypt}. Throws {@link DecryptionError} on any failure. */
export function decrypt(value: string, context: string, ring: Keyring = defaultKeyring()) {
	const parts = value.split('.');
	const version = /^v(\d+)$/.exec(parts[0] ?? '')?.[1];
	if (parts.length !== 4 || !version) throw new DecryptionError('Malformed encrypted value');
	const key = ring.key(Number(version));
	if (!key) throw new DecryptionError(`No key for version ${version}`);
	const [, nonce, ciphertext, tag] = parts.map((part) => Buffer.from(part, 'base64url'));
	try {
		const decipher = createDecipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
		decipher.setAAD(Buffer.from(context));
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
	} catch {
		throw new DecryptionError('Encrypted value failed authentication');
	}
}

/** Key version of an encrypted value, for rotation. */
export function keyVersion(value: string): number | undefined {
	const match = /^v(\d+)\./.exec(value);
	return match ? Number(match[1]) : undefined;
}

let ring: Keyring | undefined;
function defaultKeyring() {
	ring ??= singleKeyring(config().encryptionKey);
	return ring;
}
