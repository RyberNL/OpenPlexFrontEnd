import { liveTv } from '#lib/server/plex/api.js';
import { userPlex } from '#lib/server/plex/request.js';
import type { LayoutServerLoad } from './$types';

/** The DVR every Live TV page works with; null when the server has none. */
export const load: LayoutServerLoad = async (event) => ({
	dvr: await liveTv(userPlex(event))
});
