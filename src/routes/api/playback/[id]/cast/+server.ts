import { config } from '#lib/server/config.js';
import { requirePlayback } from '#lib/server/playback/relay.js';
import { castIdFor } from '#lib/server/playback/sessions.js';
import type { RequestHandler } from './$types';

/**
 * The playback's stream as an absolute URL that works without the session cookie, for AirPlay and
 * Chromecast devices, which fetch the stream themselves.
 */
export const POST: RequestHandler = async (event) => {
	const playback = requirePlayback(event);
	const base = `${config().publicOrigin}/stream/${castIdFor(playback)}`;
	const file = playback.method === 'directplay';
	return Response.json({
		src: file ? `${base}/file` : `${base}/master.m3u8`,
		contentType: file ? 'video/mp4' : 'application/x-mpegurl'
	});
};
