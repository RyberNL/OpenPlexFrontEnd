import { describe, expect, it } from 'vitest';
import { playlistDir, relativeTranscodePath, rewritePlaylist } from './playlist';

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=4457000,RESOLUTION=1912x792,FRAME-RATE=23.976000
session/abc-123/base/index.m3u8
`;

const VARIANT = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-KEY:METHOD=AES-128,URI="key?X-Plex-Token=secret"
#EXTINF:10, nodesc
00000.ts?X-Plex-Token=secret&foo=1
#EXTINF:10, nodesc
http://192.168.1.10:32400/video/:/transcode/universal/session/abc-123/base/00001.ts?X-Plex-Token=secret
#EXTINF:10, nodesc
/library/parts/1/file.mkv
#EXT-X-ENDLIST`;

describe('rewritePlaylist', () => {
	it('routes the master playlist through the relay (real PMS 1.43 format)', () => {
		expect(rewritePlaylist(MASTER, '', 'pb1')).toBe(`#EXTM3U
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=4457000,RESOLUTION=1912x792,FRAME-RATE=23.976000
/stream/pb1/hls/session/abc-123/base/index.m3u8
`);
	});

	it('rewrites segments and key URIs, strips tokens and drops foreign paths', () => {
		const out = rewritePlaylist(VARIANT, 'session/abc-123/base/', 'pb1');
		expect(out).not.toMatch(/secret|X-Plex-Token|192\.168/);
		expect(out).toContain(
			'#EXT-X-KEY:METHOD=AES-128,URI="/stream/pb1/hls/session/abc-123/base/key"'
		);
		expect(out).toContain('/stream/pb1/hls/session/abc-123/base/00000.ts?foo=1');
		expect(out).toContain('/stream/pb1/hls/session/abc-123/base/00001.ts');
		expect(out).not.toContain('/library/parts');
		expect(out.split('\n').filter((l) => l && !l.startsWith('#'))).toHaveLength(2);
	});

	it('refuses path traversal out of the transcode base', () => {
		expect(relativeTranscodePath('../../../../:/prefs', 'session/a/base/')).toBeNull();
		expect(relativeTranscodePath('session/a/../../x', '')).toBe('x');
		expect(relativeTranscodePath('javascript:alert(1)', '')).toBeNull();
	});

	it('computes playlist directories', () => {
		expect(playlistDir('session/a/base/index.m3u8')).toBe('session/a/base/');
		expect(playlistDir('index.m3u8')).toBe('');
	});
});
