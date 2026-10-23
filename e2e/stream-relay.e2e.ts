import { expect, test } from './support/test';
import { FAKE_PMS_PORT } from '../playwright.config';
import { fakePms } from './support/fake-pms';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';
import { startPlayback } from './support/playback';

const FORBIDDEN = [/x-plex-token/i, /owner-token/, /home-token-/, new RegExp(`:${FAKE_PMS_PORT}`)];

function assertNoSecrets(label: string, text: string) {
	for (const pattern of FORBIDDEN) expect(text, `${label} matches ${pattern}`).not.toMatch(pattern);
}

test.afterEach(() => fakePms('clear-patches'));
// Other tests may have left positions or watch state behind on the fake server.
test.beforeEach(() => fakePms('clear-patches'));
test.beforeEach(async ({ context }) => {
	test.skip(
		test.info().project.name !== 'chromium-desktop',
		'API-level test; one project is enough'
	);
	const user = await seedUser();
	mapToPlexOwner(user.id);
	await signInAs(context, user.id);
});

test('an H.264/AAC MP4 is direct-played through the relay with range requests', async ({
	page
}) => {
	const { status, body } = await startPlayback(page.request, '157');
	expect(status).toBe(200);
	expect(body).toMatchObject({ kind: 'file', method: 'directplay', methodLabel: 'Direct play' });
	expect(body.src).toMatch(/^\/stream\/[\w-]+\/file$/);
	assertNoSecrets('start response', JSON.stringify(body));

	const response = await page.request.get(body.src, { headers: { Range: 'bytes=0-1023' } });
	expect(response.status()).toBe(206);
	expect(response.headers()['content-type']).toBe('video/mp4');
	expect(response.headers()['content-range']).toMatch(/^bytes 0-1023\/\d+$/);
	expect((await response.body()).length).toBe(1024);
	assertNoSecrets('file headers', JSON.stringify(response.headers()));
});

test('an HEVC MKV is streamed as HLS: playlists and segments only via the relay', async ({
	page
}) => {
	const { body } = await startPlayback(page.request, '160');
	expect(body).toMatchObject({ kind: 'hls', method: 'transcode' });
	expect(body.reason).toBe('HEVC video is not supported by this browser');

	const master = await (await page.request.get(body.src)).text();
	assertNoSecrets('master', master);
	const variant = master.split('\n').find((l) => l.startsWith('/stream/'))!;
	expect(variant).toMatch(
		new RegExp(`^/stream/${body.playbackId}/hls/session/[\\w-]+/base/index\\.m3u8$`)
	);

	const variantText = await (await page.request.get(variant)).text();
	assertNoSecrets('variant', variantText);
	const segments = variantText.split('\n').filter((l) => l && !l.startsWith('#'));
	expect(segments).toHaveLength(120);
	for (const segment of segments)
		expect(segment).toMatch(/^\/stream\/[\w-]+\/hls\/session\/.+\/\d{5}\.ts$/);

	const segment = await page.request.get(segments[1]);
	expect(segment.status()).toBe(200);
	expect(segment.headers()['content-type']).toBe('video/mp2t');
	expect((await segment.body()).length).toBeGreaterThan(1000);
});

test('stream URLs are useless to other sessions and outside the transcode session', async ({
	page,
	browser
}) => {
	const { body } = await startPlayback(page.request, '160');
	const master = await (await page.request.get(body.src)).text();
	const variant = master.split('\n').find((l) => l.startsWith('/stream/'))!;

	const other = await browser.newContext();
	const otherUser = await seedUser();
	mapToPlexOwner(otherUser.id);
	await signInAs(other, otherUser.id);
	expect((await other.request.get(body.src)).status()).toBe(404);
	expect((await other.request.get(variant)).status()).toBe(404);
	expect((await other.request.get(`/stream/${body.playbackId}/file`)).status()).toBe(404);

	const traversal = `/stream/${body.playbackId}/hls/session/other-session/base/index.m3u8`;
	expect((await page.request.get(traversal)).status()).toBe(404);
	expect(
		(await page.request.get(`/stream/${body.playbackId}/hls/..%2F..%2F:%2Fprefs`)).status()
	).toBe(404);
});

test('stream URLs require a signed-in session', async ({ page, playwright }) => {
	const { body } = await startPlayback(page.request, '157');
	const anonymous = await playwright.request.newContext({ baseURL: 'http://localhost:4173' });
	expect((await anonymous.get(body.src)).status()).toBe(401);
	await anonymous.dispose();
});
