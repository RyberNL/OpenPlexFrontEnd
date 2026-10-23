import { error } from '@sveltejs/kit';
import { playlist, playlistItems } from '#lib/server/plex/api.js';
import { userPlex } from '#lib/server/plex/request.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const plex = userPlex(event);
	const found = await playlist(plex, event.params.id);
	if (!found) error(404, 'Playlist not found');
	return { playlist: found, items: await playlistItems(plex, found.id) };
};
