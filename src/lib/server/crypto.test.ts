import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, DecryptionError, encrypt, keyring, keyVersion, singleKeyring } from './crypto';

const ring = keyring(randomBytes(32));

describe('encrypt/decrypt', () => {
	it('round-trips UTF-8 text', () => {
		const value = encrypt('JBSWY3DPEHPK3PXP – ✓', 'totp', ring);
		expect(value).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
		expect(decrypt(value, 'totp', ring)).toBe('JBSWY3DPEHPK3PXP – ✓');
	});

	it('uses a fresh nonce for every value', () => {
		expect(encrypt('same', 'ctx', ring)).not.toBe(encrypt('same', 'ctx', ring));
	});

	it('detects a tampered ciphertext', () => {
		const [version, nonce, ciphertext, tag] = encrypt('secret token', 'plex', ring).split('.');
		const bytes = Buffer.from(ciphertext, 'base64url');
		bytes[0] ^= 0x01;
		const tampered = [version, nonce, bytes.toString('base64url'), tag].join('.');
		expect(() => decrypt(tampered, 'plex', ring)).toThrow(DecryptionError);
	});

	it('detects a tampered tag', () => {
		const parts = encrypt('secret token', 'plex', ring).split('.');
		parts[3] = Buffer.alloc(16).toString('base64url');
		expect(() => decrypt(parts.join('.'), 'plex', ring)).toThrow(DecryptionError);
	});

	it('rejects a value bound to another context', () => {
		const value = encrypt('secret token', 'plex:owner', ring);
		expect(() => decrypt(value, 'totp', ring)).toThrow(DecryptionError);
	});

	it('fails with the wrong key', () => {
		const value = encrypt('secret', 'ctx', ring);
		expect(() => decrypt(value, 'ctx', keyring(randomBytes(32)))).toThrow(DecryptionError);
	});

	it('fails for an unknown key version', () => {
		const value = encrypt('secret', 'ctx', keyring(randomBytes(32), 2));
		expect(() => decrypt(value, 'ctx', ring)).toThrow(/No key for version 2/);
	});

	it('decrypts any version label with the single configured key', () => {
		const key = randomBytes(32);
		const value = encrypt('secret', 'ctx', keyring(key, 3));
		expect(keyVersion(value)).toBe(3);
		expect(decrypt(value, 'ctx', singleKeyring(key))).toBe('secret');
	});

	it('rejects malformed input', () => {
		expect(() => decrypt('not-encrypted', 'ctx', ring)).toThrow(DecryptionError);
		expect(() => decrypt('x1.a.b.c', 'ctx', ring)).toThrow(DecryptionError);
	});
});
