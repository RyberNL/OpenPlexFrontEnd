import { expect, test } from './support/test';
import { signInAs } from './support/auth';
import { seedUser } from './support/db';

const PHONE_UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';

test('signing out invalidates the session on the server', async ({ browser }) => {
	const user = await seedUser();
	const context = await browser.newContext();
	const token = await signInAs(context, user.id);
	const page = await context.newPage();
	await page.goto('/settings/account');
	await page.getByRole('button', { name: 'Sign out', exact: true }).last().click();
	await expect(page).toHaveURL('/login');

	// Replaying the old cookie does not work.
	const replay = await browser.newContext();
	await replay.addCookies([{ name: 'session', value: token, url: 'http://localhost:4173' }]);
	const replayPage = await replay.newPage();
	await replayPage.goto('/');
	await expect(replayPage).toHaveURL(/\/login/);
});

test('a user can see their devices and revoke another one', async ({ browser }) => {
	const user = await seedUser();
	const laptop = await browser.newContext();
	await signInAs(laptop, user.id);
	const phone = await browser.newContext();
	await signInAs(phone, user.id, { userAgent: PHONE_UA });

	const page = await laptop.newPage();
	await page.goto('/settings/account');
	const devices = page.getByRole('region', { name: 'Signed-in devices' }).getByRole('listitem');
	await expect(devices).toHaveCount(2);
	const phoneRow = devices.filter({ hasText: 'Safari on iPhone' });
	await phoneRow.getByRole('button', { name: 'Revoke' }).click();
	await expect(devices).toHaveCount(1);

	const phonePage = await phone.newPage();
	await phonePage.goto('/');
	await expect(phonePage).toHaveURL(/\/login/);
	await page.goto('/');
	await expect(page).toHaveURL('/');
});

test('changing the password signs out other devices', async ({ browser }) => {
	const user = await seedUser();
	const laptop = await browser.newContext();
	await signInAs(laptop, user.id);
	const phone = await browser.newContext();
	await signInAs(phone, user.id, { userAgent: PHONE_UA });

	const page = await laptop.newPage();
	await page.goto('/settings/account');
	await page.getByLabel('Current password').fill('wrong password');
	await page.getByLabel('New password', { exact: true }).fill('a brand new password');
	await page.getByLabel('Confirm new password').fill('a brand new password');
	await page.getByRole('button', { name: 'Change password' }).click();
	await expect(page.getByRole('alert')).toHaveText('Your current password is not correct.');

	await page.getByLabel('Current password').fill(user.password);
	await page.getByLabel('New password', { exact: true }).fill('a brand new password');
	await page.getByLabel('Confirm new password').fill('a brand new password');
	await page.getByRole('button', { name: 'Change password' }).click();
	await expect(page.getByRole('status')).toHaveText(/Password changed/);

	const phonePage = await phone.newPage();
	await phonePage.goto('/');
	await expect(phonePage).toHaveURL(/\/login/);
	await page.goto('/');
	await expect(page).toHaveURL('/');
});
