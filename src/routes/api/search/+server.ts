import { search } from '#lib/server/plex/api.js';
import { userPlex } from '#lib/server/plex/request.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const results = await search(userPlex(event), event.url.searchParams.get('q') ?? '');
	return Response.json(results, { headers: { 'cache-control': 'private, no-store' } });
};
