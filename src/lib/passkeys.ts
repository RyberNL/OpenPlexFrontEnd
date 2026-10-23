import { startAuthentication, startRegistration, WebAuthnError } from '@simplewebauthn/browser';

export class PasskeyClientError extends Error {
	constructor(
		message: string,
		readonly code?: string
	) {
		super(message);
	}
}

async function post(url: string, body?: unknown) {
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new PasskeyClientError(data.message ?? 'Something went wrong. Try again.', data.code);
	}
	return data;
}

function friendly(error: unknown): never {
	if (error instanceof PasskeyClientError) throw error;
	const cause = (error as Error)?.cause as Error | undefined;
	const name =
		error instanceof WebAuthnError && error.code !== 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY'
			? error.code
			: (cause?.name ?? (error as Error)?.name);
	if (name === 'ERROR_CEREMONY_ABORTED' || name === 'NotAllowedError') {
		throw new PasskeyClientError('The passkey prompt was cancelled or timed out.');
	}
	if (name === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || name === 'InvalidStateError') {
		throw new PasskeyClientError('This passkey is already registered to your account.');
	}
	throw new PasskeyClientError((error as Error)?.message ?? 'Passkeys are not available here.');
}

/** Registers a new passkey for the signed-in (or enrolling) user. */
export async function registerPasskey(name?: string) {
	try {
		const { challengeId, options } = await post('/api/auth/enroll/passkey/options');
		const response = await startRegistration({ optionsJSON: options });
		return await post('/api/auth/enroll/passkey/verify', { challengeId, response, name });
	} catch (error) {
		friendly(error);
	}
}

/** Proves possession of one of the user's passkeys (second factor or step-up). */
export async function verifyWithPasskey() {
	try {
		const { challengeId, options } = await post('/api/auth/mfa/passkey/options');
		const response = await startAuthentication({ optionsJSON: options });
		return await post('/api/auth/mfa/passkey/verify', { challengeId, response });
	} catch (error) {
		friendly(error);
	}
}

/**
 * Passwordless sign-in. With `autofill`, the request waits for the user to pick a passkey from the
 * username field's autofill menu (conditional UI) instead of opening a modal prompt.
 */
export async function signInWithPasskey(returnTo: string, autofill = false) {
	try {
		const { challengeId, options } = await post('/api/auth/passkey-login/options');
		const response = await startAuthentication({
			optionsJSON: options,
			useBrowserAutofill: autofill
		});
		return await post('/api/auth/passkey-login/verify', { challengeId, response, returnTo });
	} catch (error) {
		friendly(error);
	}
}
