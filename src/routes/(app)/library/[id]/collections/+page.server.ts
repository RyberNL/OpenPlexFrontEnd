import { error } from '@sveltejs/kit';
import { collections, library } from '#lib/server/plex/api.js';
import { userPlex } from '#lib/server/plex/request.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const plex = userPlex(event);
	const lib = await library(plex, event.params.id);
	if (!lib) error(404, 'Library not found');
	return { library: lib, collections: await collections(plex, lib.id) };
};
