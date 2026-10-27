import { error } from '@sveltejs/kit';
import { PlexError } from '#lib/server/plex/errors.js';
import { hlsRequest, plexOfPlayback, requireStreamPlayback } from '#lib/server/playback/relay.js';
import { TRANSCODE_BASE } from '#lib/server/playback/playlist.js';
import type { RequestHandler } from './$types';

const HEADERS = {
	'content-type': 'text/plain; charset=utf-8',
	'cache-control': 'private, no-store'
};

/**
 * The playback's selected subtitle: the sidecar file (direct play, or a PGS file), or PMS's
 * progressively converted subtitle stream for an HLS session (streamed through as it grows).
 */
export const GET: RequestHandler = async (event) => {
	const playback = requireStreamPlayback(event);
	const subtitle = playback.subtitle;
	if (!subtitle) error(404, 'No subtitle selected');
	const plex = plexOfPlayback(playback);

	if (subtitle.delivery === 'file') {
		const upstream = await plex.fetch(`/library/streams/${subtitle.streamId}`, {
			identity: playback.device,
			headers: { Accept: '*/*' },
			signal: event.request.signal
		});
		return new Response(upstream.body, {
			headers: subtitle.image ? { ...HEADERS, 'content-type': 'application/octet-stream' } : HEADERS
		});
	}

	const { query, headers } = hlsRequest(playback);
	const upstream = await plex
		.fetch(`${TRANSCODE_BASE}subtitles`, {
			query,
			headers: { ...headers, Accept: '*/*' },
			identity: playback.device,
			signal: event.request.signal,
			timeout: 30_000
		})
		.catch((cause) => {
			// PMS refuses (400) until the session's transcode has started; the player retries.
			if (cause instanceof PlexError && cause.status === 400) error(503, 'Subtitle not ready yet');
			throw cause;
		});
	return new Response(upstream.body, { headers: HEADERS });
};
