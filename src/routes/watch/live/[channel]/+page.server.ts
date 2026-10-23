import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { liveTv } from '#lib/server/plex/api.js';
import { airingNow, channels, guideWindow } from '#lib/server/plex/livetv.js';
import { userPlex } from '#lib/server/plex/request.js';
import { getPrefs } from '#lib/server/prefs.js';
import type { PageServerLoad } from './$types';

/** The lineup (for channel up/down and the channel overlay) and what each channel airs now. */
export const load: PageServerLoad = async (event) => {
	const plex = userPlex(event);
	const dvr = await liveTv(plex);
	if (!dvr) error(404, 'Live TV is not set up on this server');
	const now = Date.now();
	const [lineup, airings] = await Promise.all([channels(plex, dvr), guideWindow(plex, dvr, now)]);
	if (!lineup.some((c) => c.id === event.params.channel)) error(404, 'Channel not found');
	return {
		prefs: getPrefs(db(), event.locals.user!.id),
		channels: lineup,
		airings,
		onNow: Object.fromEntries(airingNow(airings, now))
	};
};
