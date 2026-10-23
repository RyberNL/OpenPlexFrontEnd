import {
	hlsRequest,
	PLAYLIST_HEADERS,
	plexForPlayback,
	requirePlayback
} from '#lib/server/playback/relay.js';
import { rewritePlaylist, TRANSCODE_BASE } from '#lib/server/playback/playlist.js';
import type { RequestHandler } from './$types';

/** Starts the PMS HLS stream and returns its master playlist, rewritten to the relay. */
export const GET: RequestHandler = async (event) => {
	const playback = requirePlayback(event);
	const { query, headers } = hlsRequest(playback);
	const upstream = await plexForPlayback(event).fetch(`${TRANSCODE_BASE}start.m3u8`, {
		query,
		headers: { ...headers, Accept: '*/*' },
		identity: playback.device,
		timeout: 30_000
	});
	const playlist = rewritePlaylist(await upstream.text(), '', playback.id);
	return new Response(playlist, { headers: PLAYLIST_HEADERS });
};
