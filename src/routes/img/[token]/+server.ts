import { error } from '@sveltejs/kit';
import { PlexNotFoundError } from '#lib/server/plex/errors.js';
import { FIT_KINDS, imageSize, verifyImageToken } from '#lib/server/plex/images.js';
import { userPlex } from '#lib/server/plex/request.js';
import type { RequestHandler } from './$types';

/** Relays artwork through PMS's photo transcoder as the signed-in user's Plex identity. */
export const GET: RequestHandler = async (event) => {
	const image = verifyImageToken(event.params.token);
	if (!image) error(404, 'Not found');
	const { width, height } = imageSize(image.kind, Number(event.url.searchParams.get('w')) || 360);

	let upstream: Response;
	try {
		upstream = await userPlex(event).fetch('/photo/:/transcode', {
			query: {
				url: image.source,
				width,
				height,
				minSize: FIT_KINDS.has(image.kind) ? 0 : 1,
				upscale: 1,
				format: 'webp'
			},
			headers: { Accept: 'image/*' },
			signal: event.request.signal,
			// Plex downloads external artwork (e.g. channel logos from a CDN) on first use, which
			// can take 10–20 s before it is cached; images load in the background, so wait.
			timeout: 30_000
		});
	} catch (e) {
		if (e instanceof PlexNotFoundError) error(404, 'Not found');
		throw e;
	}
	return new Response(upstream.body, {
		headers: {
			'content-type': upstream.headers.get('content-type') ?? 'image/jpeg',
			'cache-control': 'private, max-age=86400, immutable',
			'x-content-type-options': 'nosniff'
		}
	});
};
