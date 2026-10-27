import {
	hlsRequest,
	PLAYLIST_HEADERS,
	plexOfPlayback,
	requireStreamPlayback
} from '#lib/server/playback/relay.js';
import { rewritePlaylist, TRANSCODE_BASE } from '#lib/server/playback/playlist.js';
import type { RequestHandler } from './$types';

/** Starts the PMS HLS stream and returns its master playlist, rewritten to the relay. */
export const GET: RequestHandler = async (event) => {
	const playback = requireStreamPlayback(event);
	const { query, headers } = hlsRequest(playback);
	playback.masterPlaylist ??= plexOfPlayback(playback)
		.fetch(`${TRANSCODE_BASE}start.m3u8`, {
			query,
			headers: { ...headers, Accept: '*/*' },
			identity: playback.device,
			timeout: 30_000
		})
		.then((upstream) => upstream.text())
		.catch((cause) => {
			playback.masterPlaylist = undefined;
			throw cause;
		});
	const playlist = rewritePlaylist(await playback.masterPlaylist, '', event.params.id);
	return new Response(playlist, { headers: PLAYLIST_HEADERS });
};
