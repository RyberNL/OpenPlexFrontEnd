import { expect, test } from './support/test';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';
import { FAKE_PMS_URL } from '../playwright.config';
import { fakePms, patchMetadata } from './support/fake-pms';
import { currentTime, seekVideo, waitUntilPlaying } from './support/player';

type Timeline = { ratingKey: string; state: string; time: string; session: string };
const timelines = async (): Promise<Timeline[]> =>
	(await fetch(`${FAKE_PMS_URL}/__fake/timelines`)).json();

// Other tests may have left positions or watch state behind on the fake server.
test.beforeEach(() => fakePms('clear-patches'));
test.beforeEach(async ({ context }) => {
	const user = await seedUser();
	mapToPlexOwner(user.id);
	await signInAs(context, user.id);
});
test.afterEach(() => fakePms('clear-patches'));

test('closing the player tab saves the position in Plex', async ({ page }) => {
	await page.goto('/watch/157?from=start');
	await waitUntilPlaying(page);
	// The seek reports 14 s; only reports sent when the tab closes can carry 19.5 s or more
	// (the periodic report is 10 s after playback started, i.e. not yet due).
	await seekVideo(page, 14);
	await expect.poll(() => currentTime(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(20);
	await page.close({ runBeforeUnload: true });

	// Plex keeps the last reported position (a pause, the hidden-page beacon or the final stop).
	await expect
		.poll(async () => Number((await timelines()).filter((t) => t.ratingKey === '157').at(-1)?.time))
		.toBeGreaterThanOrEqual(19_500);
	const last = (await timelines()).filter((t) => t.ratingKey === '157').at(-1)!;
	expect(Number(last.time)).toBeLessThanOrEqual(31_000);
});

test('progress is reported while playing', async ({ page }) => {
	await page.goto('/watch/157?from=start');
	await waitUntilPlaying(page);
	await expect
		.poll(async () =>
			(await timelines()).some((t) => t.ratingKey === '157' && t.state === 'playing')
		)
		.toBe(true);
});

test('resume continues on another device where playback stopped', async ({ page, browser }) => {
	await page.goto('/watch/157?from=start');
	await waitUntilPlaying(page);
	await seekVideo(page, 20);
	await page.getByRole('button', { name: 'Back', exact: true }).click();

	const phone = await browser.newContext();
	await phone.addCookies(await page.context().cookies());
	const phonePage = await phone.newPage();
	await phonePage.goto('/item/157');
	const resume = phonePage.getByRole('link', { name: /Resume from 0:(19|2\d)/ });
	await expect(resume).toHaveAttribute('href', '/watch/157?from=resume');
	await resume.click();
	await expect.poll(() => currentTime(phonePage), { timeout: 15_000 }).toBeGreaterThanOrEqual(18);
});

test('resuming a converted (HLS) movie starts at the saved position and plays', async ({
	page
}) => {
	// Movie 160 (4K HEVC) is converted by the server. Like PMS, the fake's playlist covers the
	// whole movie from 0:00, so the player must start at the position, not at the stream start.
	await patchMetadata('160', { viewOffset: 9 * 60_000 });
	await page.goto('/watch/160?from=resume');
	await waitUntilPlaying(page);
	expect(await currentTime(page)).toBeGreaterThanOrEqual(9 * 60);
	await expect(page.getByTestId('elapsed')).toHaveText(/^9:\d\d$/);
	await expect(page.getByTestId('player-error')).toHaveCount(0);
	// The transcoder was asked to start there, too.
	const starts = (await (await fetch(`${FAKE_PMS_URL}/__fake/requests`)).json()) as {
		path: string;
		query: Record<string, string>;
	}[];
	const start = starts.filter((r) => r.path.endsWith('/start.m3u8')).at(-1);
	expect(start?.query).toMatchObject({ offset: '540' });
});

test('Continue Watching items resume playback directly', async ({ page }) => {
	await page.goto('/');
	const first = page.getByRole('list', { name: 'Continue Watching' }).getByRole('link').first();
	await expect(first).toHaveAttribute('href', /^\/watch\/\d+\?from=resume$/);
});

test('passing 90% of a movie marks it watched', async ({ page }) => {
	// A 20 s "movie": 90% is reached at 18 s of the 30 s test clip.
	await patchMetadata('157', { duration: 20_000, viewCount: 0 });
	await page.goto('/watch/157?from=start');
	await waitUntilPlaying(page);
	await seekVideo(page, 19);
	await expect
		.poll(async () => {
			const response = await page.request.get('/item/157');
			return (await response.text()).includes('Mark as unwatched');
		})
		.toBe(true);
});
