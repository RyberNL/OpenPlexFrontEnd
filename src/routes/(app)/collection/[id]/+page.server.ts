import { error } from '@sveltejs/kit';
import { collectionItems, itemDetails } from '#lib/server/plex/api.js';
import { userPlex } from '#lib/server/plex/request.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const plex = userPlex(event);
	const collection = await itemDetails(plex, event.params.id);
	if (!collection || collection.type !== 'collection') error(404, 'Collection not found');
	return { collection, items: await collectionItems(plex, collection.id) };
};
