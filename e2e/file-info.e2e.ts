import fs from 'node:fs';
import { expect, test } from './support/test';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';
import { fakePms, patchMetadata } from './support/fake-pms';
import { waitUntilPlaying } from './support/player';

test.beforeEach(async ({ context }) => {
	test.skip(!test.info().project.name.endsWith('desktop'), 'One viewport per engine is enough');
	await fakePms('clear-patches');
	const user = await seedUser();
	mapToPlexOwner(user.id);
	await signInAs(context, user.id);
});
test.afterEach(() => fakePms('clear-patches'));

/** Movie 157 (MP4, H.264) with an AAC or a DTS audio track. */
async function withAudio(codec: 'aac' | 'dts') {
	const listing = JSON.parse(
		fs.readFileSync('test/fixtures/plex/section-movies-page-200.json', 'utf8')
	);
	const media = listing.MediaContainer.Metadata.find(
		(m: { ratingKey: string }) => m.ratingKey === '157'
	).Media[0];
	await patchMetadata('157', {
		Media: [
			{
				...media,
				audioCodec: codec,
				Part: [
					{
						...media.Part[0],
						file: '/media/movies/Example Movie (2018)/Example.Movie.2018.1080p.mp4',
						Stream: [
							{
								id: 1571,
								streamType: 1,
								codec: 'h264',
								bitrate: 2047,
								extendedDisplayTitle: '1080p (H.264 High)'
							},
							{
								id: 1572,
								streamType: 2,
								codec,
								bitrate: codec === 'dts' ? 1509 : 256,
								selected: true,
								extendedDisplayTitle: `English (${codec.toUpperCase()} 5.1)`
							}
						]
					}
				]
			}
		]
	});
}

test('File info explains why a file is transcoded', async ({ page }) => {
	await withAudio('dts');
	await page.goto('/watch/157?from=start');
	await waitUntilPlaying(page);
	await page.getByRole('button', { name: 'File info' }).click();

	const panel = page.getByRole('dialog', { name: 'File info' });
	await expect(panel.getByTestId('file-info-method')).toHaveText('Transcode');
	await expect(panel.getByTestId('file-info-reason')).toHaveText(
		'DTS audio is not supported by this browser'
	);
	await expect(panel).toContainText('Example.Movie.2018.1080p.mp4');
	// Only the file's name: the server's folders stay private.
	await expect(panel).not.toContainText('/media/movies/');
	await expect(panel).toContainText('MP4');
	await expect(panel.getByRole('list', { name: 'Video streams' })).toContainText(
		'1080p (H.264 High) · 2.0 Mbps'
	);
	await expect(panel.getByRole('list', { name: 'Audio streams' })).toContainText(
		'English (DTS 5.1) · 1.5 Mbps (playing)'
	);

	await page.keyboard.press('Escape');
	await expect(panel).toHaveCount(0);
});

test('File info shows direct play without a reason', async ({ page }) => {
	await withAudio('aac');
	await page.goto('/watch/157?from=start');
	await waitUntilPlaying(page);
	await page.keyboard.press('i');
	const panel = page.getByRole('dialog', { name: 'File info' });
	await expect(panel.getByTestId('file-info-method')).toHaveText('Direct play');
	await expect(panel.getByTestId('file-info-reason')).toHaveCount(0);
});
