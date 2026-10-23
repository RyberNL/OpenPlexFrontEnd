import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from './support/test';
import { FAKE_PMS_PORT } from '../playwright.config';
import { submitPassword } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';
import { seedTotp } from './support/factors';
import { fakePms, patchMetadata } from './support/fake-pms';
import { waitUntilPlaying } from './support/player';

/**
 * A complete session of a regular user, recorded as a HAR: sign-in with password and
 * authenticator code, browsing, a transcoded and a direct-played movie with subtitles and scrub
 * previews, Live TV, and sign-out. Nothing in it may contain a Plex token or the PMS address.
 */
const FORBIDDEN = [
	/x-plex-token/i,
	/owner-token/,
	/owner-account-token/,
	/home-token-/,
	/home-user-token-/,
	new RegExp(`127\\.0\\.0\\.1:${FAKE_PMS_PORT}`),
	new RegExp(`localhost:${FAKE_PMS_PORT}`)
];

test.afterEach(() => Promise.all([fakePms('clear-patches'), fakePms('free-tuner')]));

async function untilLive(page: Page) {
	const video = page.getByTestId('video');
	let last = -1;
	await expect
		.poll(async () => {
			const t = await video.evaluate((v: HTMLVideoElement) => {
				if (v.paused && v.readyState >= 1) {
					v.muted = true;
					void v.play().catch(() => {});
				}
				return v.currentTime;
			});
			const advancing = last >= 0 && t > last;
			last = t;
			return advancing;
		})
		.toBe(true);
}

test('a full user session exposes no Plex token or PMS address', async ({ browser }) => {
	test.skip(test.info().project.name !== 'chromium-desktop', 'One recorded session is enough');
	test.setTimeout(180_000);
	await fakePms('free-tuner');
	const listing = JSON.parse(
		fs.readFileSync('test/fixtures/plex/section-movies-page-200.json', 'utf8')
	);
	const media = listing.MediaContainer.Metadata.find(
		(m: { ratingKey: string }) => m.ratingKey === '157'
	).Media;
	await patchMetadata('157', {
		Media: media.map((m: { Part: object[] }) => ({
			...m,
			Part: m.Part.map((p) => ({
				...p,
				indexes: 'sd',
				Stream: [
					{ id: 1571, streamType: 1, codec: 'h264' },
					{ id: 1572, streamType: 2, codec: 'aac', selected: true },
					{
						id: 1573,
						streamType: 3,
						codec: 'srt',
						key: '/library/streams/1573',
						selected: true
					}
				]
			}))
		}))
	});

	const user = await seedUser();
	mapToPlexOwner(user.id);
	const totp = seedTotp(user.id);
	const harPath = path.join(test.info().outputDir, 'session.har');
	const context = await browser.newContext({ recordHar: { path: harPath, content: 'embed' } });
	const page = await context.newPage();

	// Sign in with password and authenticator code.
	await submitPassword(page, user.username, user.password);
	await expect(page).toHaveURL('/login/mfa');
	await page.getByLabel('Code from your authenticator app').fill(totp.generate());
	await page.getByRole('button', { name: 'Verify', exact: true }).click();
	await expect(page).toHaveURL('/');

	// Browse.
	for (const url of ['/', '/library/1', '/library/2', '/item/160', '/search?q=fast']) {
		await page.goto(url);
		await page.waitForLoadState('networkidle');
	}

	// A transcoded movie, then a direct-played one with subtitles and scrub previews.
	await page.goto('/watch/160?from=start');
	await waitUntilPlaying(page);
	await page.goto('/watch/157?from=start');
	await waitUntilPlaying(page);
	await expect(page.getByTestId('subtitles')).toBeAttached();
	const bar = (await page.getByRole('slider', { name: 'Seek' }).boundingBox())!;
	await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
	await expect(page.getByTestId('seek-thumbnail')).toBeVisible();

	// Live TV: channels, guide, and a channel.
	await page.goto('/live');
	await page.goto('/live/guide');
	await page.waitForLoadState('networkidle');
	await page.goto('/watch/live/1032');
	await untilLive(page);

	// Sign out.
	await page.goto('/settings/account');
	await page.locator('form[action="/logout"]').getByRole('button', { name: 'Sign out' }).click();
	await expect(page).toHaveURL(/\/login/);
	await context.close();

	const har = fs.readFileSync(harPath, 'utf8');
	const entries = JSON.parse(har).log.entries as { request: { url: string } }[];
	expect(entries.length).toBeGreaterThan(100);
	const paths = new Set(entries.map((e) => new URL(e.request.url).pathname.split('/')[1]));
	// The recording covers sign-in, pages, APIs, images, media streams and Live TV.
	for (const area of ['login', 'api', 'img', 'stream', 'live', 'watch']) {
		expect(paths, `HAR has /${area} requests`).toContain(area);
	}
	const found = FORBIDDEN.filter((pattern) => pattern.test(har)).map(String);
	expect(found).toEqual([]);
});
