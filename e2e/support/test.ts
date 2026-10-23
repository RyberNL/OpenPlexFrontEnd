import { test as base, type BrowserContext } from '@playwright/test';

export { expect } from '@playwright/test';

/**
 * Playwright's test, plus automatic cleanup of extra browser contexts that a test opens (e.g. a
 * second device), so media players and pages don't pile up in a long-running browser.
 */
export const test = base.extend<{ closeExtraContexts: void }>({
	closeExtraContexts: [
		async ({ browser }, use) => {
			const created: BrowserContext[] = [];
			const original = browser.newContext.bind(browser);
			browser.newContext = async (...args) => {
				const context = await original(...args);
				created.push(context);
				return context;
			};
			await use();
			browser.newContext = original;
			await Promise.all(created.map((c) => c.close().catch(() => {})));
		},
		{ auto: true }
	]
});
