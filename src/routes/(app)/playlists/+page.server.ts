import { videoPlaylists } from '#lib/server/plex/api.js';
import { userPlex } from '#lib/server/plex/request.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => ({
	playlists: await videoPlaylists(userPlex(event))
});
