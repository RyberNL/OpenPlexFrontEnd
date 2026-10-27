import { error } from '@sveltejs/kit';
import {
	PLAYLIST_HEADERS,
	plexOfPlayback,
	relayResponse,
	requireStreamPlayback
} from '#lib/server/playback/relay.js';
import { playlistDir, rewritePlaylist, TRANSCODE_BASE } from '#lib/server/playback/playlist.js';
import { keepLiveAlive } from '#lib/server/playback/timeline.js';
import type { RequestHandler } from './$types';

/** Variant playlists and segments of this playback's own transcode session only. */
export const GET: RequestHandler = async (event) => {
	const playback = requireStreamPlayback(event);
	const path = event.params.path;
	if (!path.startsWith(`session/${playback.plexSession}/`) || path.split('/').includes('..')) {
		error(404, 'Not found');
	}
	const query = Object.fromEntries(event.url.searchParams);
	const plex = plexOfPlayback(playback);
	// A Chromecast keeps watching after the page that cast it is gone, and sends no reports.
	if (path.endsWith('.m3u8')) void keepLiveAlive(plex, playback).catch(() => {});
	const upstream = await plex.fetch(`${TRANSCODE_BASE}${path}`, {
		query,
		headers: { Accept: '*/*' },
		identity: playback.device,
		signal: event.request.signal,
		timeout: 30_000
	});
	if (path.endsWith('.m3u8')) {
		const playlist = rewritePlaylist(await upstream.text(), playlistDir(path), event.params.id);
		return new Response(playlist, { headers: PLAYLIST_HEADERS });
	}
	return relayResponse(upstream);
};
