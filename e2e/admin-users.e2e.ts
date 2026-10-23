import { expect, test, type Page } from './support/test';
import { signInAs, submitPassword } from './support/auth';
import { e2eDb, seedUser } from './support/db';

async function asAdmin(page: Page) {
	const admin = await seedUser({ role: 'admin' });
	await signInAs(page.context(), admin.id);
	return admin;
}

async function openUser(page: Page, username: string) {
	await page.goto('/admin/users');
	await page
		.getByRole('list', { name: 'Users' })
		.getByRole('link', { name: new RegExp(`@${username}`) })
		.click();
}

test('regular users get 403 on administration pages', async ({ context, page }) => {
	const user = await seedUser();
	await signInAs(context, user.id);
	const response = await page.goto('/admin/users');
	expect(response?.status()).toBe(403);

	// Admin APIs and form actions are refused too, not just the pages.
	const api = await page.request.get('/api/admin/plex/link');
	expect(api.status()).toBe(403);
	const create = await page.request.post('/admin/users?/create', {
		headers: { origin: 'http://localhost:4173' },
		form: { username: 'sneaky', displayName: 'Sneaky', role: 'admin' }
	});
	expect(create.status()).toBe(403);
});

test('an admin creates a user who must change password and enroll at first sign-in', async ({
	page,
	browser
}) => {
	await asAdmin(page);
	const username = `anna${Date.now().toString(36)}`;
	await page.goto('/admin/users');
	await page.getByRole('button', { name: 'Add user' }).click();
	await page.getByLabel('Username').fill(username);
	await page.getByLabel('Display name').fill('Anna');
	await page.getByLabel('Temporary password').fill('temporary password 1');
	await page.getByRole('button', { name: 'Create user' }).click();
	await expect(page.getByRole('heading', { name: 'Anna' })).toBeVisible();
	await expect(page.getByRole('status')).toHaveText(/User created/);

	const anna = await (await browser.newContext()).newPage();
	await submitPassword(anna, username, 'temporary password 1');
	await expect(anna).toHaveURL('/change-password');
	await anna.getByLabel('New password', { exact: true }).fill('annas own password');
	await anna.getByLabel('Confirm new password').fill('annas own password');
	await anna.getByRole('button', { name: 'Set password' }).click();
	await expect(anna).toHaveURL('/enroll');
});

test('creating a duplicate username shows an error', async ({ page }) => {
	await asAdmin(page);
	const existing = await seedUser();
	await page.goto('/admin/users');
	await page.getByRole('button', { name: 'Add user' }).click();
	await page.getByLabel('Username').fill(existing.username.toUpperCase());
	await page.getByLabel('Temporary password').fill('temporary password 1');
	await page.getByRole('button', { name: 'Create user' }).click();
	await expect(page.getByRole('alert')).toHaveText('That username is already taken.');
});

test('disabling a signed-in user revokes their sessions immediately', async ({ page, browser }) => {
	await asAdmin(page);
	const anna = await seedUser();
	const annaContext = await browser.newContext();
	await signInAs(annaContext, anna.id);
	const annaPage = await annaContext.newPage();
	await annaPage.goto('/');
	await expect(annaPage).toHaveURL('/');

	await openUser(page, anna.username);
	await page.getByRole('button', { name: 'Disable user' }).click();
	await expect(page.getByRole('status')).toHaveText(/disabled and signed out/);

	await annaPage.goto('/');
	await expect(annaPage).toHaveURL(/\/login/);

	await page.getByRole('button', { name: 'Enable user' }).click();
	await expect(page.getByRole('status')).toHaveText('User enabled.');
});

test('an admin cannot disable, demote or delete their own account', async ({ page }) => {
	const admin = await asAdmin(page);
	await openUser(page, admin.username);
	await expect(page.getByRole('button', { name: 'Disable user' })).toHaveCount(0);
	await expect(page.getByLabel('Role')).toBeDisabled();

	// Even a crafted request is refused by the server.
	for (const action of ['disable', 'delete']) {
		const response = await page.request.post(`/admin/users/${admin.id}?/${action}`, {
			form: {},
			headers: { origin: 'http://localhost:4173', accept: 'application/json' }
		});
		const body = await response.json();
		expect(body.type).toBe('failure');
		expect(JSON.stringify(body.data)).toContain('your own account');
	}
	const db = e2eDb();
	expect(db.prepare('select disabled from users where id = ?').pluck().get(admin.id)).toBe(0);
	db.close();
});

test('an admin can promote, rename and delete another user', async ({ page }) => {
	await asAdmin(page);
	const ben = await seedUser();
	await openUser(page, ben.username);
	await page.getByLabel('Display name').fill('Benjamin');
	await page.getByLabel('Role').selectOption('admin');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByRole('status')).toHaveText('Changes saved.');
	await expect(page.getByText(`@${ben.username} · Administrator`)).toBeVisible();

	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Delete user' }).click();
	await expect(page).toHaveURL('/admin/users');
	await expect(page.getByRole('list', { name: 'Users' })).not.toContainText(`@${ben.username}`);
});
