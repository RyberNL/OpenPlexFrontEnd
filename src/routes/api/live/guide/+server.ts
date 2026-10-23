import { error, json } from '@sveltejs/kit';
import { liveTv } from '#lib/server/plex/api.js';
import { GUIDE_WINDOW, guideWindow } from '#lib/server/plex/livetv.js';
import { userPlex } from '#lib/server/plex/request.js';
import type { RequestHandler } from './$types';

/** Guide airings for the 3-hour window starting at `?from=<ms>` (within two days of now). */
export const GET: RequestHandler = async (event) => {
	const from = Number(event.url.searchParams.get('from'));
	const now = Date.now();
	if (!Number.isFinite(from) || Math.abs(from - now) > 2 * 24 * 3600_000) {
		error(400, 'Invalid window');
	}
	const plex = userPlex(event);
	const dvr = await liveTv(plex);
	if (!dvr) error(404, 'Live TV is not set up on this server');
	const start = from - (from % 1800_000);
	return json({
		from: start,
		to: start + GUIDE_WINDOW,
		airings: await guideWindow(plex, dvr, start)
	});
};
