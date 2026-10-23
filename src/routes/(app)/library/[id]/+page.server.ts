import { error } from '@sveltejs/kit';
import {
	LIBRARY_SORTS,
	letterIndex,
	library,
	libraryOptions,
	libraryPage,
	parseLibraryQuery
} from '#lib/server/plex/api.js';
import { userPlex } from '#lib/server/plex/request.js';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 60;

export const load: PageServerLoad = async (event) => {
	const plex = userPlex(event);
	const lib = await library(plex, event.params.id);
	if (!lib) error(404, 'This library does not exist or you do not have access to it.');

	const { sort, filters } = parseLibraryQuery(event.url.searchParams);
	const [page, options, letters] = await Promise.all([
		libraryPage(plex, lib.id, { sort, filters, offset: 0, size: PAGE_SIZE }),
		libraryOptions(plex, lib.id, lib.type),
		sort === 'title' ? letterIndex(plex, lib.id, filters) : Promise.resolve([])
	]);
	return {
		library: lib,
		page,
		options,
		letters,
		sort,
		filters,
		sorts: Object.entries(LIBRARY_SORTS).map(([value, s]) => ({ value, label: s.label }))
	};
};
