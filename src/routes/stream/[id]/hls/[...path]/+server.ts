import { error } from '@sveltejs/kit';
import {
	PLAYLIST_HEADERS,
	plexForPlayback,
	relayResponse,
	requirePlayback
} from '#lib/server/playback/relay.js';
import { playlistDir, rewritePlaylist, TRANSCODE_BASE } from '#lib/server/playback/playlist.js';
import type { RequestHandler } from './$types';

/** Variant playlists and segments of this playback's own transcode session only. */
export const GET: RequestHandler = async (event) => {
	const playback = requirePlayback(event);
	const path = event.params.path;
	if (!path.startsWith(`session/${playback.plexSession}/`) || path.split('/').includes('..')) {
		error(404, 'Not found');
	}
	const query = Object.fromEntries(event.url.searchParams);
	const upstream = await plexForPlayback(event).fetch(`${TRANSCODE_BASE}${path}`, {
		query,
		headers: { Accept: '*/*' },
		identity: playback.device,
		signal: event.request.signal,
		timeout: 30_000
	});
	if (path.endsWith('.m3u8')) {
		const playlist = rewritePlaylist(await upstream.text(), playlistDir(path), playback.id);
		return new Response(playlist, { headers: PLAYLIST_HEADERS });
	}
	return relayResponse(upstream);
};
