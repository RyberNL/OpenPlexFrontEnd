import { json } from '@sveltejs/kit';
import { parseQueue, queueOrder, queuePosition } from '#lib/queue.js';
import { collectionItems, episodeAfter, itemDetails, playlistItems } from '#lib/server/plex/api.js';
import { plexForPlayback, requirePlayback } from '#lib/server/playback/relay.js';
import type { RequestHandler } from './$types';

/**
 * What plays after this playback's item: the next item of its play queue (`?queue=…&shuffle=…
 * &pos=…`, as in the watch URL), else the following episode of its show. `next` is null at the
 * end; `pos` is the next item's queue position.
 */
export const GET: RequestHandler = async (event) => {
	const playback = requirePlayback(event);
	const plex = plexForPlayback(event);
	const params = event.url.searchParams;

	const queue = parseQueue(params.get('queue'));
	if (queue) {
		const items =
			queue.source === 'playlist'
				? await playlistItems(plex, queue.id)
				: await collectionItems(plex, queue.id);
		const order = queueOrder(items.length, Number(params.get('shuffle')) || undefined);
		const pos = params.has('pos') ? Number(params.get('pos')) : undefined;
		const at = queuePosition(
			items.map((i) => i.id),
			order,
			playback.ratingKey,
			Number.isInteger(pos) ? pos : undefined
		);
		if (at >= 0) {
			const next = at + 1 < order.length ? items[order[at + 1]] : null;
			return json({ next, pos: next ? at + 1 : null });
		}
	}

	const item = await itemDetails(plex, playback.ratingKey);
	return json({ next: item ? await episodeAfter(plex, item) : null, pos: null });
};
