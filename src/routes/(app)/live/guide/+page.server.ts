import { channels, GUIDE_WINDOW, guideWindow } from '#lib/server/plex/livetv.js';
import { userPlex } from '#lib/server/plex/request.js';
import type { PageServerLoad } from './$types';

const HALF_HOUR = 1800_000;

/** The guide starts half an hour before the current half hour and runs 25 hours. */
export const load: PageServerLoad = async (event) => {
	const { dvr } = await event.parent();
	if (!dvr) return { channels: [], windows: [], start: 0, end: 0, now: Date.now() };
	const plex = userPlex(event);
	const now = Date.now();
	const start = now - (now % HALF_HOUR) - HALF_HOUR;
	// The first two windows (6 hours) come with the page; the rest load while scrolling.
	const [lineup, first, second] = await Promise.all([
		channels(plex, dvr),
		guideWindow(plex, dvr, start),
		guideWindow(plex, dvr, start + GUIDE_WINDOW)
	]);
	return {
		now,
		start,
		end: start + 25 * 3600_000,
		channels: lineup,
		windows: [
			{ from: start, airings: first },
			{ from: start + GUIDE_WINDOW, airings: second }
		]
	};
};
