import { removePlayback } from '#lib/server/playback/sessions.js';
import { plexForPlayback, requirePlayback } from '#lib/server/playback/relay.js';
import { releaseTuner, stopTranscode } from '#lib/server/playback/timeline.js';
import type { RequestHandler } from './$types';

/**
 * Discards a playback being replaced (new offset, quality or stream, or another channel), stopping
 * its transcode and freeing its tuner. Awaited by the player before tuning another channel.
 */
export const DELETE: RequestHandler = async (event) => {
	const playback = requirePlayback(event);
	removePlayback(playback.id);
	const plex = plexForPlayback(event);
	await Promise.allSettled([stopTranscode(plex, playback), releaseTuner(plex, playback)]);
	return new Response(null, { status: 204 });
};
