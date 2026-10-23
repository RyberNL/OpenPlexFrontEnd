import { beforeAll, describe, expect, it } from 'vitest';
import { imageSize, imageUrl, verifyImageToken } from './images';

beforeAll(() => {
	process.env.PUBLIC_ORIGIN = 'https://plex.example.com';
	process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('base64');
});

const tokenOf = (url: string) => url.slice('/img/'.length, url.indexOf('?'));

describe('signed image URLs', () => {
	it('round-trips the source path and kind', () => {
		const url = imageUrl('/library/metadata/160/thumb/1789964721', 'poster', 360)!;
		expect(url).toMatch(/^\/img\/[\w-]+\.[\w-]+\?w=360$/);
		expect(verifyImageToken(tokenOf(url))).toEqual({
			kind: 'poster',
			source: '/library/metadata/160/thumb/1789964721'
		});
	});

	it('supports external artwork URLs', () => {
		const source = 'https://metadata-static.plex.tv/3/people/abc.jpg';
		expect(verifyImageToken(tokenOf(imageUrl(source, 'square', 160)!))?.source).toBe(source);
	});

	it('rejects tampered payloads and signatures', () => {
		const token = tokenOf(imageUrl('/library/metadata/160/thumb/1', 'poster', 360)!);
		const [payload, signature] = token.split('.');
		const forgedPayload = Buffer.from('poster|/:/prefs').toString('base64url');
		expect(verifyImageToken(`${forgedPayload}.${signature}`)).toBeNull();
		expect(verifyImageToken(`${payload}.${'A'.repeat(signature.length)}`)).toBeNull();
		expect(verifyImageToken(payload)).toBeNull();
	});

	it('returns undefined when there is no image', () => {
		expect(imageUrl(undefined, 'poster', 360)).toBeUndefined();
	});

	it('snaps requested widths to the allowed sizes', () => {
		expect(imageSize('poster', 300)).toEqual({ width: 320, height: 480 });
		expect(imageSize('art', 99999)).toEqual({ width: 1920, height: 1080 });
		expect(imageSize('square', 1)).toEqual({ width: 80, height: 80 });
	});
});
