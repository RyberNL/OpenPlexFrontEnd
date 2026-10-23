import type { BrowserContext, Page } from '@playwright/test';

/**
 * Attaches a Chromium virtual platform authenticator (biometrics-capable, resident keys) to the
 * page. Returns helpers to toggle user verification and inspect stored credentials.
 */
export async function addVirtualAuthenticator(context: BrowserContext, page: Page) {
	const cdp = await context.newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true
		}
	});
	return {
		/**
		 * Turns automatic approval of prompts on or off. Chromium's virtual authenticator also
		 * auto-approves the sign-in page's passkey autofill (conditional UI) request, which a real
		 * user only triggers by picking a passkey, so tests switch this off around /login visits.
		 */
		setPresence: (enabled: boolean) =>
			cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled }),
		/** Simulates the user failing or dismissing the biometric prompt. */
		setUserVerified: (isUserVerified: boolean) =>
			cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified }),
		credentials: async () =>
			(await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials
	};
}

/**
 * Asks the authenticator for any discoverable credential (ignoring the server's allow-list) and
 * posts the assertion to the second-factor endpoint, so the server-side account check is exercised.
 */
export async function assertWithAnyPasskey(page: Page) {
	return page.evaluate(async () => {
		const b64url = (buf: ArrayBuffer) =>
			btoa(String.fromCharCode(...new Uint8Array(buf)))
				.replace(/\+/g, '-')
				.replace(/\//g, '_')
				.replace(/=+$/, '');
		const fromB64url = (s: string) =>
			Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

		const { challengeId, options } = await (
			await fetch('/api/auth/mfa/passkey/options', { method: 'POST' })
		).json();
		const credential = (await navigator.credentials.get({
			publicKey: {
				challenge: fromB64url(options.challenge),
				rpId: options.rpId,
				userVerification: 'required',
				allowCredentials: []
			}
		})) as PublicKeyCredential;
		const response = credential.response as AuthenticatorAssertionResponse;
		const result = await fetch('/api/auth/mfa/passkey/verify', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				challengeId,
				response: {
					id: credential.id,
					rawId: b64url(credential.rawId),
					type: 'public-key',
					clientExtensionResults: {},
					response: {
						clientDataJSON: b64url(response.clientDataJSON),
						authenticatorData: b64url(response.authenticatorData),
						signature: b64url(response.signature),
						userHandle: response.userHandle ? b64url(response.userHandle) : undefined
					}
				}
			})
		});
		return { status: result.status, body: await result.json() };
	});
}
