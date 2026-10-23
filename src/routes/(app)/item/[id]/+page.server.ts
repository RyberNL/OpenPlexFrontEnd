import { error } from '@sveltejs/kit';
import { children, itemDetails, nextEpisode, setWatched } from '#lib/server/plex/api.js';
import { userPlex } from '#lib/server/plex/request.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const plex = userPlex(event);
	const item = await itemDetails(plex, event.params.id);
	if (!item) error(404, 'This item does not exist or you do not have access to it.');

	if (item.type === 'show') {
		const [seasons, next] = await Promise.all([
			children(plex, item.id),
			nextEpisode(plex, item.id)
		]);
		return { item, seasons, next, episodes: [] };
	}
	if (item.type === 'season') {
		return { item, episodes: await children(plex, item.id), seasons: [], next: null };
	}
	return { item, seasons: [], episodes: [], next: null };
};

export const actions: Actions = {
	watched: async (event) => {
		const watched = (await event.request.formData()).get('watched') === '1';
		await setWatched(userPlex(event), event.params.id, watched);
		return { watched };
	}
};
