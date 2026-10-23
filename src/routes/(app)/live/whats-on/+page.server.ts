import { channels, groupByCategory, guideWindow } from '#lib/server/plex/livetv.js';
import { userPlex } from '#lib/server/plex/request.js';
import type { PageServerLoad } from './$types';

/** Airing now, and starting within the next hour, grouped by the guide's categories if any. */
export const load: PageServerLoad = async (event) => {
	const { dvr } = await event.parent();
	if (!dvr) return { now: Date.now(), channels: [], onNow: [], soon: [] };
	const plex = userPlex(event);
	const now = Date.now();
	const [lineup, airings] = await Promise.all([channels(plex, dvr), guideWindow(plex, dvr, now)]);
	const onNow = airings.filter((a) => a.beginsAt <= now && now < a.endsAt);
	const soon = airings.filter((a) => a.beginsAt > now && a.beginsAt <= now + 3600_000);
	return {
		now,
		channels: lineup,
		onNow: groupByCategory(onNow),
		soon: groupByCategory(soon)
	};
};
