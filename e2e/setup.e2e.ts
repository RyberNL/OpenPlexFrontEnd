import { expect, test } from './support/test';
import { E2E_SETUP_TOKEN, FAKE_PMS_URL } from '../playwright.config';
import { signInAs } from './support/auth';
import { countUsers, seedUser } from './support/db';

test.describe.configure({ mode: 'serial' });

test('setup refuses a wrong setup token', async ({ page }) => {
	expect(countUsers()).toBe(0);
	await page.goto('/setup');
	await page.getByLabel('Setup token').fill('not-the-token');
	await page.getByLabel('Username').fill('admin');
	await page.getByLabel('Password', { exact: true }).fill('a very long password');
	await page.getByLabel('Confirm password').fill('a very long password');
	await page.getByRole('button', { name: 'Create admin account' }).click();
	await expect(page.getByRole('alert')).toHaveText(/setup token is not correct/);
	expect(countUsers()).toBe(0);
});

test('setup creates the first admin and leads to MFA enrollment', async ({ page }) => {
	// While no account exists, visitors are sent to first-run setup.
	await page.goto('/');
	await expect(page).toHaveURL('/setup');
	await page.getByLabel('Setup token').fill(E2E_SETUP_TOKEN);
	await page.getByLabel('Username').fill('admin');
	await page.getByLabel('Display name').fill('Administrator');
	await page.getByLabel('Password', { exact: true }).fill('a very long password');
	await page.getByLabel('Confirm password').fill('a very long password');
	await page.getByRole('button', { name: 'Create admin account' }).click();
	await expect(page).toHaveURL('/enroll');
	await expect(
		page.getByRole('heading', { name: 'Set up two-factor authentication' })
	).toBeVisible();
	expect(countUsers()).toBe(1);
});

test('setup is closed once an account exists', async ({ browser }) => {
	const page = await (await browser.newContext()).newPage();
	await page.goto('/setup');
	await expect(page).toHaveURL(/\/login$/);
	const response = await page.request.post('/setup', {
		form: { token: E2E_SETUP_TOKEN, username: 'intruder', password: 'x'.repeat(20) },
		headers: { origin: 'http://localhost:4173', accept: 'text/html' },
		maxRedirects: 0
	});
	expect(response.status()).toBe(303);
	expect(countUsers()).toBe(1);
});

test('linking reports an unreachable Plex server', async ({ page }) => {
	const admin = await seedUser({ role: 'admin' });
	await signInAs(page.context(), admin.id);
	await page.goto('/admin/plex');
	await page.getByLabel('Server address').fill('http://127.0.0.1:9');
	await page.getByRole('button', { name: 'Connect' }).click();
	await expect(page.getByRole('alert')).toHaveText(
		'Could not reach http://127.0.0.1:9. Check the address and that Plex is running.'
	);
});

test('an admin links the Plex server by approving a PIN on plex.tv', async ({ page }) => {
	const admin = await seedUser({ role: 'admin' });
	await signInAs(page.context(), admin.id);
	await page.goto('/admin/plex');
	await expect(page.getByLabel('Server address')).toHaveValue(FAKE_PMS_URL);
	await page.getByRole('button', { name: 'Connect' }).click();
	await expect(page.getByTestId('plex-pin')).toHaveText(/^\s*\w{4}\s*$/);
	await expect(page.getByRole('status')).toHaveText('Waiting for approval…');

	// The owner approves the code on plex.tv (simulated by the fake).
	await fetch(`${FAKE_PMS_URL}/__fake/approve-pins`, { method: 'POST' });

	const server = page.getByTestId('plex-server');
	await expect(server).toContainText('version 1.43.5.11029-6bf8af3f0', { timeout: 10_000 });
	await expect(server).toContainText('Connected');
	await expect(server).toContainText(FAKE_PMS_URL);
});
