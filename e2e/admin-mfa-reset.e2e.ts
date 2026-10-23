import { expect, test } from './support/test';
import { signInAs, submitPassword } from './support/auth';
import { e2eDb, seedUser } from './support/db';
import { seedRecoveryCodes, seedTotp } from './support/factors';

test('after an admin resets MFA, the user signs in with their password and must enroll again', async ({
	page,
	browser
}) => {
	const admin = await seedUser({ role: 'admin' });
	await signInAs(page.context(), admin.id);

	const anna = await seedUser();
	seedTotp(anna.id);
	seedRecoveryCodes(anna.id);
	const annaContext = await browser.newContext();
	await signInAs(annaContext, anna.id);

	await page.goto('/admin/users');
	await page.getByRole('link', { name: new RegExp(`@${anna.username}`) }).click();
	await expect(page.getByText('0 passkey(s) and 1 authenticator app(s).')).toBeVisible();

	// The admin page shows counts only, never secrets.
	const db = e2eDb();
	const secretEnc = db
		.prepare('select secret_enc from totp_authenticators where user_id = ?')
		.pluck()
		.get(anna.id) as string;
	db.close();
	expect(await page.content()).not.toContain(secretEnc);

	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Reset two-factor' }).click();
	await expect(page.getByRole('status')).toHaveText(/Two-factor authentication reset/);
	await expect(page.getByText('Not set up yet.')).toBeVisible();

	// Anna's existing session is gone.
	const annaPage = await annaContext.newPage();
	await annaPage.goto('/');
	await expect(annaPage).toHaveURL(/\/login/);

	// Her password still works, and she is asked to set up a new factor.
	await submitPassword(annaPage, anna.username, anna.password);
	await expect(annaPage).toHaveURL('/enroll');
});
