import { error } from '@sveltejs/kit';
import { PlexNotFoundError } from '#lib/server/plex/errors.js';
import { BifError, frameIndexAt, parseBif } from '#lib/server/playback/bif.js';
import { plexForPlayback, requirePlayback } from '#lib/server/playback/relay.js';
import type { RequestHandler } from './$types';

/** Larger index files are not kept in memory (a feature film's is a few MB). */
const MAX_BIF_BYTES = 64 * 1024 * 1024;

/**
 * The preview thumbnail (JPEG) at `?t=<ms>` of the playing part. PMS serves all of a part's
 * thumbnails as one BIF file; it is fetched once per playback and kept with the session.
 */
export const GET: RequestHandler = async (event) => {
	const playback = requirePlayback(event);
	const time = Number(event.url.searchParams.get('t'));
	if (!Number.isFinite(time) || time < 0) error(400, 'Invalid time');

	playback.previews ??= plexForPlayback(event)
		.fetch(`/library/parts/${playback.partId}/indexes/sd`, {
			identity: playback.device,
			headers: { Accept: '*/*' },
			timeout: 30_000
		})
		.then(async (response) => {
			if (Number(response.headers.get('content-length')) > MAX_BIF_BYTES) {
				await response.body?.cancel();
				return null;
			}
			const data = Buffer.from(await response.arrayBuffer());
			return data.length > MAX_BIF_BYTES ? null : parseBif(data);
		})
		.catch((cause) => {
			if (cause instanceof BifError || cause instanceof PlexNotFoundError) return null;
			// Not cached: a failed download is retried on the next request.
			playback.previews = undefined;
			throw cause;
		});
	const bif = await playback.previews;
	const index = bif ? frameIndexAt(bif, time) : -1;
	if (!bif || index < 0) error(404, 'No preview thumbnails');
	return new Response(new Uint8Array(bif.frame(index)), {
		headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=3600' }
	});
};
