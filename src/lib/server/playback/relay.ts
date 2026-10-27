import { error, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import { streamHeaders, streamQuery } from '../plex/decision';
import { plexFor } from '../plex/session';
import { CAST_PREFIX, getCastPlayback, getPlayback, type PlaybackSession } from './sessions';

/** The playback named in the URL, if it belongs to this browser session. */
export function requirePlayback(event: RequestEvent): PlaybackSession {
	const playback = getPlayback(event.params.id!, event.locals.session?.idHash);
	if (!playback) error(404, 'Not found');
	return playback;
}

export function plexForPlayback(event: RequestEvent) {
	return plexFor(db(), event.locals.user!);
}

/**
 * The playback named in a /stream URL: by its id, for the browser session that owns it, or by its
 * cast id, for a device that fetches the stream itself (see `castIdFor`).
 */
export function requireStreamPlayback(event: RequestEvent): PlaybackSession {
	const id = event.params.id!;
	const playback = id.startsWith(CAST_PREFIX)
		? getCastPlayback(id)
		: getPlayback(id, event.locals.session?.idHash);
	if (!playback) error(404, 'Not found');
	return playback;
}

/** Plex as the playback's user; a cast device's requests come without a session. */
export function plexOfPlayback(playback: PlaybackSession) {
	const user = db().select().from(users).where(eq(users.id, playback.userId)).get();
	if (!user || user.disabled) error(404, 'Not found');
	return plexFor(db(), user);
}

/** The StreamRequest PMS needs to start (or continue) this playback's HLS transcode. */
export function hlsRequest(playback: PlaybackSession) {
	const request = {
		ratingKey: playback.ratingKey,
		mediaIndex: playback.mediaIndex,
		partIndex: playback.partIndex,
		quality: playback.quality,
		caps: playback.caps,
		session: playback.plexSession,
		device: playback.device,
		offset: playback.startAt / 1000,
		subtitleMode: playback.subtitleMode
	};
	return { query: streamQuery(request), headers: streamHeaders(request) };
}

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges'];

/** Response for relayed media bytes: streamed, never cached by shared caches. */
export function relayResponse(upstream: Response) {
	const headers = new Headers({ 'cache-control': 'private, no-store' });
	for (const name of PASS_HEADERS) {
		const value = upstream.headers.get(name);
		if (value) headers.set(name, value);
	}
	return new Response(upstream.body, { status: upstream.status, headers });
}

export const PLAYLIST_HEADERS = {
	'content-type': 'application/vnd.apple.mpegurl',
	'cache-control': 'private, no-store'
};
