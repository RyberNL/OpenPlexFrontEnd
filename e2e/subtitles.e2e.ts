import fs from 'node:fs';
import { expect, test, type Page } from './support/test';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';
import { fakePms, fakePmsRequests, patchMetadata } from './support/fake-pms';
import { seekVideo, waitUntilPlaying } from './support/player';

test.beforeEach(async ({ context }) => {
	test.skip(!test.info().project.name.endsWith('desktop'), 'One viewport per engine is enough');
	await fakePms('clear-patches');
	const user = await seedUser();
	mapToPlexOwner(user.id);
	await signInAs(context, user.id);
});
test.afterEach(() => fakePms('clear-patches'));

const cue = (page: Page) => page.getByTestId('subtitle-cue');

const SUBTITLES = {
	srt: { id: 1573, codec: 'srt', languageCode: 'nld', displayTitle: 'Nederlands (SRT)' },
	ass: { id: 1574, codec: 'ass', languageCode: 'eng', displayTitle: 'English (ASS)' },
	pgs: { id: 1575, codec: 'pgs', languageCode: 'eng', displayTitle: 'English (PGS)' }
};

/**
 * Gives movie 157 (direct-playable MP4) a selected subtitle: a sidecar file (SRT, styled ASS or
 * PGS), or an embedded PGS track.
 */
async function withSubtitle(format: keyof typeof SUBTITLES, embedded = false) {
	const subtitle = SUBTITLES[format];
	const listing = JSON.parse(
		fs.readFileSync('test/fixtures/plex/section-movies-page-200.json', 'utf8')
	);
	const movie = listing.MediaContainer.Metadata.find(
		(m: { ratingKey: string }) => m.ratingKey === '157'
	);
	const media = movie.Media.map((m: { Part: { Stream?: object[] }[] }) => ({
		...m,
		Part: m.Part.map((p) => ({
			...p,
			Stream: [
				{ id: 1571, streamType: 1, codec: 'h264' },
				{ id: 1572, streamType: 2, codec: 'aac', languageCode: 'eng', selected: true },
				{
					...subtitle,
					streamType: 3,
					selected: true,
					...(embedded ? {} : { key: `/library/streams/${subtitle.id}` })
				}
			]
		}))
	}));
	await patchMetadata('157', { Media: media });
}

/**
 * Strongly red pixels in the screenshot of `selector`. The test clip's colour bars include red,
 * so the video is shown in grayscale: red can only come from a subtitle drawn over it.
 */
async function redPixels(page: Page, selector: string) {
	await page.addStyleTag({ content: 'video { filter: grayscale(1) !important; }' });
	const png = await page.locator(selector).screenshot();
	return page.evaluate(async (data) => {
		const image = new Image();
		image.src = `data:image/png;base64,${data}`;
		await image.decode();
		const canvas = document.createElement('canvas');
		canvas.width = image.width;
		canvas.height = image.height;
		const context = canvas.getContext('2d')!;
		context.drawImage(image, 0, 0);
		const pixels = context.getImageData(0, 0, image.width, image.height).data;
		let red = 0;
		for (let i = 0; i < pixels.length; i += 4)
			if (pixels[i] > 200 && pixels[i + 1] < 60 && pixels[i + 2] < 60) red++;
		return red;
	}, png.toString('base64'));
}

test('a sidecar subtitle file shows during direct play', async ({ page }) => {
	await withSubtitle('srt');
	const requested = new Set<string>();
	page.on('request', (r) => requested.add(new URL(r.url()).pathname));
	await page.goto('/watch/157?from=start');
	await waitUntilPlaying(page);
	await seekVideo(page, 5.5);
	await expect(cue(page)).toHaveText('Second line');
	await seekVideo(page, 17);
	await expect(cue(page)).toHaveText('Fourth line,\non two rows');
	// Styled-subtitle rendering is only downloaded for ASS/SSA.
	expect([...requested].filter((p) => /jassub|\.wasm$/i.test(p))).toEqual([]);
});

test('a styled ASS subtitle keeps its styling, or shows as simple subtitles', async ({ page }) => {
	await withSubtitle('ass');
	await page.goto('/watch/157?from=start');
	await waitUntilPlaying(page);
	await page.getByRole('button', { name: 'Pause' }).click();
	await seekVideo(page, 3);
	// The "Sign" style is big, bold and red at the top: only libass draws that.
	const canvas = page.getByTestId('ass-subtitles');
	await expect(canvas).toBeVisible();
	await expect(cue(page)).toHaveCount(0);
	await expect.poll(() => redPixels(page, '[data-testid="ass-subtitles"]')).toBeGreaterThan(500);

	await page.getByRole('button', { name: 'Subtitles' }).click();
	await page.getByRole('menuitemcheckbox', { name: 'Simple subtitles' }).click();
	await expect(canvas).toHaveCount(0);
	await expect(cue(page)).toHaveText(['STYLED SIGN', 'Plain dialogue line']);
});

test('a PGS subtitle file is drawn by the browser during direct play', async ({ page }) => {
	await withSubtitle('pgs');
	const before = (await fakePmsRequests()).length;
	await page.goto('/watch/157?from=start');
	await waitUntilPlaying(page);
	await page.getByRole('button', { name: 'Pause' }).click();
	await seekVideo(page, 3);
	// The fixture is a red box near the bottom of the frame from 0:01 to 0:30.
	await expect(page.getByTestId('pgs-subtitles')).toBeVisible();
	await expect.poll(() => redPixels(page, '[data-testid="pgs-subtitles"]')).toBeGreaterThan(500);
	await seekVideo(page, 0.5);
	await expect.poll(() => redPixels(page, '[data-testid="pgs-subtitles"]')).toBe(0);
	const transcodes = (await fakePmsRequests())
		.slice(before)
		.filter((r) => r.path.includes('/transcode/'));
	expect(transcodes).toEqual([]);
});

test('an embedded PGS subtitle is burned in by the server', async ({ page }) => {
	await withSubtitle('pgs', true);
	await page.goto('/watch/157?from=start');
	await waitUntilPlaying(page);
	const decision = (await fakePmsRequests())
		.filter((r) => r.path === '/video/:/transcode/universal/decision')
		.at(-1);
	expect(decision?.query).toMatchObject({ subtitles: 'burn' });
	await expect(page.getByTestId('pgs-subtitles')).toHaveCount(0);
	await expect(cue(page)).toHaveCount(0);
});

test('an embedded subtitle can be turned on from the menu and off again', async ({ page }) => {
	await page.goto('/watch/160?from=start');
	await waitUntilPlaying(page);
	await page.getByRole('button', { name: 'Subtitles' }).click();
	const menu = page.getByRole('menu', { name: 'Subtitles' });
	await expect(menu.getByRole('menuitemradio', { name: 'Off' })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await menu.getByRole('menuitemradio', { name: /English/ }).click();
	await waitUntilPlaying(page);
	await expect(cue(page).first()).toBeVisible({ timeout: 15_000 });

	await page.getByRole('button', { name: 'Subtitles' }).click();
	await page
		.getByRole('menu', { name: 'Subtitles' })
		.getByRole('menuitemradio', { name: 'Off' })
		.click();
	await waitUntilPlaying(page);
	await expect(cue(page)).toHaveCount(0);
});

test('the c key toggles subtitles', async ({ page }) => {
	await withSubtitle('srt');
	await page.goto('/watch/157?from=start');
	await waitUntilPlaying(page);
	await page.keyboard.press('c');
	await expect(page.getByRole('button', { name: 'Subtitles' })).toHaveAttribute(
		'aria-pressed',
		'false'
	);
	await page.keyboard.press('c');
	await expect(page.getByRole('button', { name: 'Subtitles' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
});

test('choosing larger subtitles renders them larger', async ({ page }, info) => {
	await withSubtitle('srt');
	const measure = async (size: string) => {
		await page.goto('/settings/playback');
		await page.getByLabel('Size').selectOption({ label: size });
		await page.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByRole('status')).toHaveText('Settings saved.');
		await page.goto('/watch/157?from=start');
		await waitUntilPlaying(page);
		await seekVideo(page, 11);
		await page.getByTestId('video').evaluate((v: HTMLVideoElement) => v.pause());
		await expect(cue(page)).toHaveText('Third line');
		await info.attach(`subtitles-${size}.png`, {
			body: await page.screenshot(),
			contentType: 'image/png'
		});
		return (await cue(page).boundingBox())!.height;
	};
	const small = await measure('Small');
	const large = await measure('Large');
	expect(large).toBeGreaterThan(small * 1.3);
});
