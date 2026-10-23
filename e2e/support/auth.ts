import { expect, type BrowserContext, type Page } from '@playwright/test';
import { seedSession } from './db';

/** Fills and submits the sign-in form, waiting until the server has answered. */
export async function submitPassword(page: Page, username: string, password: string) {
	if (!page.url().includes('/login')) await page.goto('/login');
	await page.getByLabel('Username').fill(username);
	await page.getByLabel('Password').fill(password);
	const response = page.waitForResponse(
		(r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/login'
	);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await response;
}

/** Signs a browser context in as `userId` with a seeded full session. */
export async function signInAs(
	context: BrowserContext,
	userId: string,
	options: { userAgent?: string; stepUpAgoMs?: number | null } = {}
) {
	const token = seedSession(userId, 'full', options.userAgent, options.stepUpAgoMs ?? 0);
	await context.addCookies([{ name: 'session', value: token, url: 'http://localhost:4173' }]);
	return token;
}

/** After a first enrollment, acknowledges the one-time recovery codes screen. */
export async function continuePastRecoveryCodes(page: Page) {
	await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
	await page.getByRole('button', { name: 'I saved them, continue' }).click();
}
