import { expect, test, type Browser } from './support/test';
import { submitPassword } from './support/auth';
import { seedUser } from './support/db';
import { seedRecoveryCodes, seedTotp, totpFor } from './support/factors';

async function signInWithRecoveryCode(
	browser: Browser,
	user: { username: string; password: string },
	code: string
) {
	const page = await (await browser.newContext()).newPage();
	await submitPassword(page, user.username, user.password);
	await expect(page).toHaveURL('/login/mfa');
	await page.getByText('Use a recovery code').click();
	await page.getByLabel('Recovery code').fill(code);
	await page.getByRole('button', { name: 'Use recovery code' }).click();
	return page;
}

test('first enrollment shows 10 recovery codes exactly once', async ({ page }) => {
	const user = await seedUser();
	await submitPassword(page, user.username, user.password);
	await page.getByRole('button', { name: 'Use an authenticator app' }).click();
	const secret = (await page.getByTestId('totp-secret').innerText()).replace(/\s/g, '');
	await page.getByLabel('6-digit code').fill(totpFor(secret).generate());
	await page.getByRole('button', { name: 'Verify and save' }).click();

	await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
	const codes = page.getByTestId('recovery-codes').getByRole('listitem');
	await expect(codes).toHaveCount(10);
	await expect(codes.first()).toHaveText(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
	await page.getByRole('button', { name: 'I saved them, continue' }).click();
	await expect(page).toHaveURL('/');

	await page.goto('/enroll');
	await expect(page).toHaveURL('/');
});

test('a recovery code signs in once and can never be reused', async ({ browser }) => {
	const user = await seedUser();
	seedTotp(user.id);
	const [code] = seedRecoveryCodes(user.id);

	const first = await signInWithRecoveryCode(browser, user, code.toLowerCase());
	await expect(first).toHaveURL('/');

	const second = await signInWithRecoveryCode(browser, user, code);
	await expect(second.getByRole('alert')).toHaveText('That recovery code is not valid.');
	await expect(second).toHaveURL('/login/mfa');
});

test('regenerating shows a new set and invalidates every earlier code', async ({ browser }) => {
	const user = await seedUser();
	const totp = seedTotp(user.id);
	const old = seedRecoveryCodes(user.id);

	const page = await (await browser.newContext()).newPage();
	await submitPassword(page, user.username, user.password);
	await page.getByLabel('Code from your authenticator app').fill(totp.generate());
	await page.getByRole('button', { name: 'Verify', exact: true }).click();
	await expect(page).toHaveURL('/');

	await page.goto('/settings/security');
	await expect(page.getByText('10 of 10 unused codes left')).toBeVisible();
	await page.getByRole('button', { name: 'Generate new recovery codes' }).click();
	const items = page.getByTestId('recovery-codes').getByRole('listitem');
	await expect(items).toHaveCount(10);
	const fresh = await items.allInnerTexts();

	const rejected = await signInWithRecoveryCode(browser, user, old[1]);
	await expect(rejected.getByRole('alert')).toHaveText('That recovery code is not valid.');
	const accepted = await signInWithRecoveryCode(browser, user, fresh[0]);
	await expect(accepted).toHaveURL('/');
});
