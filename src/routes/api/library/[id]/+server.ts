import { libraryPage, parseLibraryQuery } from '#lib/server/plex/api.js';
import { userPlex } from '#lib/server/plex/request.js';
import type { RequestHandler } from './$types';

/** Further pages for the library grid. */
export const GET: RequestHandler = async (event) => {
	const { sort, filters } = parseLibraryQuery(event.url.searchParams);
	const offset = Math.max(0, Number(event.url.searchParams.get('offset')) || 0);
	const size = Math.min(200, Math.max(1, Number(event.url.searchParams.get('size')) || 60));
	const page = await libraryPage(userPlex(event), event.params.id, { sort, filters, offset, size });
	return Response.json(page, { headers: { 'cache-control': 'private, no-store' } });
};
