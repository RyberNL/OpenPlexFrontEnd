import { search } from '#lib/server/plex/api.js';
import { userPlex } from '#lib/server/plex/request.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const q = event.url.searchParams.get('q') ?? '';
	return { q, results: q.trim().length >= 2 ? await search(userPlex(event), q) : null };
};
