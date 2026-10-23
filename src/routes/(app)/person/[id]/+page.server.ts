import { personItems } from '#lib/server/plex/api.js';
import { userPlex } from '#lib/server/plex/request.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const items = await personItems(userPlex(event), event.params.id);
	// The name is only a display hint passed along from the page that linked here.
	const name = event.url.searchParams.get('name')?.slice(0, 100) || 'Person';
	return { name, items };
};
