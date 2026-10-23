import { expect, test, type Page } from './support/test';
import { continuePastRecoveryCodes, submitPassword } from './support/auth';
import { e2eDb, seedUser } from './support/db';
import { seedTotp, totpFor } from './support/factors';

async function submitCode(page: Page, code: string) {
	await page.getByLabel('Code from your authenticator app').fill(code);
	await page.getByRole('button', { name: 'Verify', exact: true }).click();
}

test('enrolling Google Authenticator saves it and completes sign-in', async ({ page }) => {
	const user = await seedUser();
	await submitPassword(page, user.username, user.password);
	await expect(page).toHaveURL('/enroll');
	await page.getByRole('button', { name: 'Use an authenticator app' }).click();
	await expect(page.getByAltText('QR code for your authenticator app')).toBeVisible();

	const secret = (await page.getByTestId('totp-secret').innerText()).replace(/\s/g, '');
	await page.getByLabel('6-digit code').fill('000000');
	await page.getByRole('button', { name: 'Verify and save' }).click();
	await expect(page.getByRole('alert')).toHaveText(/not correct/);
	// The same setup key is still shown, so the user can retry.
	await expect(page.getByTestId('totp-secret')).toHaveText(secret.match(/.{1,4}/g)!.join(' '));

	await page.getByLabel('6-digit code').fill(totpFor(secret).generate());
	await page.getByLabel('Name', { exact: true }).fill('Pixel');
	await page.getByRole('button', { name: 'Verify and save' }).click();
	await continuePastRecoveryCodes(page);
	await expect(page).toHaveURL('/');

	const db = e2eDb();
	const saved = db
		.prepare('select name, secret_enc from totp_authenticators where user_id = ?')
		.all(user.id) as {
		name: string;
		secret_enc: string;
	}[];
	db.close();
	expect(saved).toHaveLength(1);
	expect(saved[0].name).toBe('Pixel');
	expect(saved[0].secret_enc).not.toContain(secret);
});

test('a valid code completes sign-in and returns to the deep link', async ({ page }) => {
	const user = await seedUser();
	const totp = seedTotp(user.id);
	await page.goto('/settings/account?tab=1');
	await expect(page).toHaveURL(/\/login\?returnTo=/);
	await submitPassword(page, user.username, user.password);
	await expect(page).toHaveURL('/login/mfa');
	await submitCode(page, totp.generate());
	await expect(page).toHaveURL('/settings/account?tab=1');
});

test('an absolute return target to another site is ignored', async ({ page }) => {
	const user = await seedUser();
	const totp = seedTotp(user.id);
	await page.goto('/login?returnTo=https%3A%2F%2Fevil.example%2Fphish');
	await submitPassword(page, user.username, user.password);
	await submitCode(page, totp.generate());
	await expect(page).toHaveURL('/');
});

test('a wrong code keeps the session pending', async ({ page }) => {
	const user = await seedUser();
	seedTotp(user.id);
	await submitPassword(page, user.username, user.password);
	await submitCode(page, '123456');
	await expect(page.getByRole('alert')).toHaveText('That code is not correct.');
	await page.goto('/');
	await expect(page).toHaveURL('/login/mfa');
});

test('a code cannot be replayed within its validity window', async ({ browser }) => {
	const user = await seedUser();
	const code = seedTotp(user.id).generate();

	const first = await (await browser.newContext()).newPage();
	await submitPassword(first, user.username, user.password);
	await submitCode(first, code);
	await expect(first).toHaveURL('/');

	const second = await (await browser.newContext()).newPage();
	await submitPassword(second, user.username, user.password);
	await submitCode(second, code);
	await expect(second.getByRole('alert')).toHaveText('That code is not correct.');
	await expect(second).toHaveURL('/login/mfa');
});

test('failed codes count towards the account lockout', async ({ page }) => {
	const user = await seedUser();
	const totp = seedTotp(user.id);
	await submitPassword(page, user.username, user.password);
	for (let i = 0; i < 9; i++) {
		const response = page.waitForResponse((r) => r.request().method() === 'POST');
		await submitCode(page, '000000');
		await response;
	}
	await submitCode(page, '000000');
	await expect(page.getByRole('alert')).toHaveText(/Too many failed attempts/);
	await submitCode(page, totp.generate());
	await expect(page.getByRole('alert')).toHaveText(/Too many failed attempts/);
});
