import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import type { MediaItem, Person } from '#lib/plex-types.js';
import { config } from '../config';

/** Widths the relay will produce; heights are derived from the requested aspect. */
export const IMAGE_WIDTHS = [80, 120, 160, 240, 320, 360, 480, 640, 960, 1280, 1920] as const;

export type ImageKind = 'poster' | 'art' | 'thumb' | 'square' | 'logo';
const ASPECT: Record<ImageKind, number> = {
	poster: 1.5,
	art: 9 / 16,
	thumb: 9 / 16,
	square: 1,
	logo: 1
};

/** Kinds scaled to fit inside the box instead of filling (and cropping) it. */
export const FIT_KINDS: ReadonlySet<ImageKind> = new Set(['logo']);

let signingKey: Buffer | undefined;
function key() {
	signingKey ??= Buffer.from(
		hkdfSync('sha256', config().encryptionKey, Buffer.alloc(0), 'image-url-signing', 32)
	);
	return signingKey;
}

function sign(payload: string) {
	return createHmac('sha256', key()).update(payload).digest().subarray(0, 16).toString('base64url');
}

/** App URL for a PMS image path (or external artwork URL), or undefined when there is none. */
export function imageUrl(source: string | undefined | null, kind: ImageKind, width: number) {
	if (!source) return undefined;
	const payload = Buffer.from(`${kind}|${source}`).toString('base64url');
	return `/img/${payload}.${sign(payload)}?w=${width}`;
}

/** Verifies a signed image token and returns the source and kind, or null when tampered. */
export function verifyImageToken(token: string) {
	const dot = token.lastIndexOf('.');
	if (dot <= 0) return null;
	const payload = token.slice(0, dot);
	const given = Buffer.from(token.slice(dot + 1), 'base64url');
	const expected = Buffer.from(sign(payload), 'base64url');
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
	const decoded = Buffer.from(payload, 'base64url').toString('utf8');
	const separator = decoded.indexOf('|');
	const kind = decoded.slice(0, separator) as ImageKind;
	if (!(kind in ASPECT)) return null;
	return { kind, source: decoded.slice(separator + 1) };
}

export function imageSize(kind: ImageKind, requestedWidth: number) {
	const width =
		IMAGE_WIDTHS.find((w) => w >= requestedWidth) ?? IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1];
	return { width, height: Math.round(width * ASPECT[kind]) };
}

const person = (p: Person): Person => ({ ...p, thumb: imageUrl(p.thumb, 'square', 160) });

/** Replaces PMS image paths in an item with signed app image URLs. */
export function presentItem(item: MediaItem): MediaItem {
	const episodeLike = item.type === 'episode' || item.type === 'clip';
	return {
		...item,
		thumb: imageUrl(item.thumb, episodeLike ? 'thumb' : 'poster', episodeLike ? 480 : 360),
		art: imageUrl(item.art, 'art', 1280),
		directors: item.directors.map(person),
		writers: item.writers.map(person),
		cast: item.cast.map(person),
		chapters: item.chapters.map((c) => ({ ...c, thumb: imageUrl(c.thumb, 'thumb', 320) })),
		extras: item.extras.map(presentItem)
	};
}
