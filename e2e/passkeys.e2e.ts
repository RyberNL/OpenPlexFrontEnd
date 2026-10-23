import { expect, test, type Page } from './support/test';
import { continuePastRecoveryCodes, submitPassword } from './support/auth';
import { e2eDb, seedUser } from './support/db';
import { seedTotp } from './support/factors';
import { addVirtualAuthenticator, assertWithAnyPasskey } from './support/webauthn';

test.skip(({ browserName }) => browserName !== 'chromium', 'Virtual authenticators need Chromium');

type Authenticator = Awaited<ReturnType<typeof addVirtualAuthenticator>>;

function passkeysOf(userId: string) {
	const db = e2eDb();
	const rows = db
		.prepare('select name from webauthn_credentials where user_id = ?')
		.all(userId) as { name: string }[];
	db.close();
	return rows;
}

/**
 * Makes the sign-in page's autofill (conditional UI) request fail on the next visit, so a test can
 * exercise the explicit button without racing the virtual authenticator.
 */
async function skipAutofillOnce(page: Page) {
	let first = true;
	await page.route('**/api/auth/passkey-login/options', (route) => {
		if (!first) return route.continue();
		first = false;
		return route.fulfill({ status: 503, json: { message: 'skipped in test' } });
	});
}

/** Creates a user, enrolls a passkey on the authenticator, then signs out. */
async function userWithPasskey(page: Page, authenticator: Authenticator) {
	const user = await seedUser();
	await submitPassword(page, user.username, user.password);
	await page.getByRole('button', { name: 'Add a passkey' }).click();
	await continuePastRecoveryCodes(page);
	await expect(page).toHaveURL('/');
	await authenticator.setPresence(false);
	await page.goto('/settings/account');
	await page.getByRole('button', { name: 'Sign out', exact: true }).last().click();
	await expect(page).toHaveURL('/login');
	return user;
}

test('registering a platform passkey during enrollment completes sign-in', async ({
	context,
	page
}) => {
	const authenticator = await addVirtualAuthenticator(context, page);
	const user = await seedUser();
	await submitPassword(page, user.username, user.password);
	await expect(page).toHaveURL('/enroll');
	await page.getByRole('button', { name: 'Add a passkey' }).click();
	await continuePastRecoveryCodes(page);
	await expect(page).toHaveURL('/');
	expect(await authenticator.credentials()).toHaveLength(1);
	expect(passkeysOf(user.id)).toEqual([{ name: expect.stringMatching(/^Chrome on /) }]);
});

test('a cancelled passkey prompt saves nothing and explains why', async ({ context, page }) => {
	const authenticator = await addVirtualAuthenticator(context, page);
	await authenticator.setUserVerified(false);
	const user = await seedUser();
	await submitPassword(page, user.username, user.password);
	await page.getByRole('button', { name: 'Add a passkey' }).click();
	await expect(page.getByRole('alert')).toHaveText(/cancelled or timed out/);
	await expect(page).toHaveURL('/enroll');
	expect(passkeysOf(user.id)).toHaveLength(0);
});

test('a passkey completes sign-in as the second factor', async ({ context, page }) => {
	const authenticator = await addVirtualAuthenticator(context, page);
	const user = await userWithPasskey(page, authenticator);
	await submitPassword(page, user.username, user.password);
	await expect(page).toHaveURL('/login/mfa');
	await authenticator.setPresence(true);
	await page.getByRole('button', { name: 'Use a passkey' }).click();
	await expect(page).toHaveURL('/');
});

test('a passkey of another account is rejected as second factor', async ({ context, page }) => {
	const authenticator = await addVirtualAuthenticator(context, page);
	await userWithPasskey(page, authenticator);

	// Ben has a TOTP authenticator only, and tries the other user's passkey as his second factor.
	const ben = await seedUser();
	seedTotp(ben.id);
	await submitPassword(page, ben.username, ben.password);
	await expect(page).toHaveURL('/login/mfa');
	await authenticator.setPresence(true);
	const result = await assertWithAnyPasskey(page);
	expect(result.status).toBe(400);
	expect(result.body.message).toBe('This passkey belongs to a different account.');
	await page.goto('/');
	await expect(page).toHaveURL('/login/mfa');
});

test.describe('passwordless sign-in', () => {
	test('the "Sign in with a passkey" button signs in without username or password', async ({
		context,
		page
	}) => {
		const authenticator = await addVirtualAuthenticator(context, page);
		await userWithPasskey(page, authenticator);
		await skipAutofillOnce(page);
		await authenticator.setPresence(true);
		await page.goto('/login?returnTo=%2Fsettings%2Faccount');
		await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
		await expect(page).toHaveURL('/settings/account');
	});

	test('picking a passkey from autofill signs in', async ({ context, page }) => {
		const authenticator = await addVirtualAuthenticator(context, page);
		await userWithPasskey(page, authenticator);
		// With presence on, the virtual authenticator answers the autofill request like a user
		// choosing their passkey from the username field's suggestions.
		// Leave /login first so its pending autofill request can't be approved early.
		await page.goto('about:blank');
		await authenticator.setPresence(true);
		// The autofill sign-in can redirect before the page finishes loading.
		await page.goto('/login?returnTo=%2Fsettings%2Faccount', { waitUntil: 'commit' });
		await expect(page).toHaveURL('/settings/account');
	});

	test('refuses a disabled account', async ({ context, page }) => {
		const authenticator = await addVirtualAuthenticator(context, page);
		const user = await userWithPasskey(page, authenticator);
		const db = e2eDb();
		db.prepare('update users set disabled = 1 where id = ?').run(user.id);
		db.close();
		await skipAutofillOnce(page);
		await authenticator.setPresence(true);
		await page.goto('/login');
		await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
		await expect(page.getByRole('alert')).toHaveText('This account has been disabled.');
		await page.goto('/');
		await expect(page).toHaveURL(/\/login/);
	});

	test('explains when the prompt is dismissed', async ({ context, page }) => {
		const authenticator = await addVirtualAuthenticator(context, page);
		await authenticator.setUserVerified(false);
		await page.goto('/login');
		await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
		await expect(page.getByRole('alert')).toHaveText(/cancelled or timed out/);
	});
});

test.describe('managing passkeys in settings', () => {
	test('a passkey can be added after a recent verification', async ({ context, page }) => {
		await addVirtualAuthenticator(context, page);
		const user = await seedUser();
		seedTotp(user.id);
		const { signInAs } = await import('./support/auth');
		await signInAs(context, user.id);
		await page.goto('/settings/security');
		await page.getByRole('button', { name: 'Add a passkey' }).click();
		await expect(page.getByText('Passkey added.')).toBeVisible();
		await expect(page.getByRole('list', { name: 'Sign-in methods' })).toContainText('Chrome on');
		expect(passkeysOf(user.id)).toHaveLength(1);
	});

	test('adding a passkey without a recent verification is refused', async ({ context, page }) => {
		await addVirtualAuthenticator(context, page);
		const user = await seedUser();
		seedTotp(user.id);
		const { signInAs } = await import('./support/auth');
		await signInAs(context, user.id, { stepUpAgoMs: 10 * 60_000 });
		await page.goto('/settings/security');
		await page.getByRole('button', { name: 'Add a passkey' }).click();
		await expect(page.getByRole('alert')).toHaveText('Verify it’s you first.');
		expect(passkeysOf(user.id)).toHaveLength(0);
	});
});
