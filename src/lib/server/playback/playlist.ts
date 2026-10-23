/** PMS path under which all HLS transcode resources live. */
export const TRANSCODE_BASE = '/video/:/transcode/universal/';

const TOKEN_PARAMS = /^(x-plex-token|token|accesstoken|x-plex-client-identifier)$/i;

/**
 * Resolves a playlist URI against the playlist's location and returns its path relative to the
 * transcode base (plus any harmless query), or null when it points anywhere else.
 */
export function relativeTranscodePath(uri: string, playlistPath: string): string | null {
	let url: URL;
	try {
		url = new URL(uri, `http://pms${TRANSCODE_BASE}${playlistPath}`);
	} catch {
		return null;
	}
	if (url.host !== 'pms' && !/^https?:$/.test(url.protocol)) return null;
	if (!url.pathname.startsWith(TRANSCODE_BASE)) return null;
	for (const key of [...url.searchParams.keys()]) {
		if (TOKEN_PARAMS.test(key)) url.searchParams.delete(key);
	}
	const relative = url.pathname.slice(TRANSCODE_BASE.length);
	if (relative.split('/').includes('..')) return null;
	return relative + (url.search === '?' ? '' : url.search);
}

/**
 * Rewrites every URI in an HLS playlist (variant lines and URI="…" attributes) to go through the
 * app's relay for `playbackId`. Tokens are stripped; URIs outside the transcode base are dropped.
 */
export function rewritePlaylist(text: string, playlistPath: string, playbackId: string) {
	const relay = (uri: string) => {
		const relative = relativeTranscodePath(uri, playlistPath);
		return relative === null ? null : `/stream/${playbackId}/hls/${relative}`;
	};
	return text
		.split(/\r?\n/)
		.flatMap((line) => {
			const trimmed = line.trim();
			if (!trimmed) return [line];
			if (trimmed.startsWith('#')) {
				return [
					line.replace(/URI="([^"]*)"/g, (match, uri: string) => {
						const rewritten = relay(uri);
						return rewritten ? `URI="${rewritten}"` : 'URI=""';
					})
				];
			}
			const rewritten = relay(trimmed);
			return rewritten ? [rewritten] : [];
		})
		.join('\n');
}

/** Directory of a relative playlist path, used to resolve its own URIs. */
export function playlistDir(relativePath: string) {
	const index = relativePath.lastIndexOf('/');
	return index < 0 ? '' : relativePath.slice(0, index + 1);
}
