import { hash, verify } from '@node-rs/argon2';

/** argon2id parameters (OWASP baseline: 19 MiB, 2 iterations, 1 lane). */
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export function hashPassword(password: string): Promise<string> {
	return hash(password, OPTIONS);
}

let dummyHash: Promise<string> | undefined;

/**
 * Verifies a password against a stored hash. When `storedHash` is null (unknown user),
 * a dummy hash is still verified so response timing does not reveal whether the account exists.
 */
export async function verifyPassword(storedHash: string | null, password: string) {
	if (storedHash === null) {
		dummyHash ??= hashPassword('dummy password for timing equalization');
		await verify(await dummyHash, password).catch(() => false);
		return false;
	}
	return verify(storedHash, password).catch(() => false);
}

/** Returns a user-facing problem with the password, or null when it satisfies the policy. */
export function passwordPolicyError(password: string, username: string): string | null {
	const length = [...password].length;
	if (length < PASSWORD_MIN_LENGTH)
		return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`;
	if (length > PASSWORD_MAX_LENGTH)
		return `Password must be at most ${PASSWORD_MAX_LENGTH} characters long.`;
	if (password.toLowerCase() === username.toLowerCase())
		return 'Password must not be the same as the username.';
	return null;
}
