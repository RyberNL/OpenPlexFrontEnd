import { plexForPlayback, relayResponse, requirePlayback } from '#lib/server/playback/relay.js';
import type { RequestHandler } from './$types';

/** Direct play: the original file, with Range requests passed through for seeking. */
export const GET: RequestHandler = async (event) => {
	const playback = requirePlayback(event);
	const range = event.request.headers.get('range');
	const upstream = await plexForPlayback(event).fetch(playback.partKey, {
		identity: playback.device,
		headers: { Accept: '*/*', ...(range ? { Range: range } : {}) },
		signal: event.request.signal
	});
	return relayResponse(upstream);
};
