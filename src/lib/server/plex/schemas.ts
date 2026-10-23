/**
 * Lenient zod schemas for the parts of PMS JSON responses the app uses. Unknown fields pass
 * through; only fields we read are declared, all optional unless PMS always sends them.
 */
import { z } from 'zod';

const num = z.coerce.number();
const str = z.coerce.string();
const bool = z
	.union([z.boolean(), z.number(), z.string()])
	.transform((v) => v === true || v === 1 || v === '1');

export const tagSchema = z.looseObject({
	id: num.optional(),
	tag: str,
	role: str.optional(),
	thumb: str.optional(),
	filter: str.optional()
});

export const streamSchema = z.looseObject({
	id: num,
	streamType: num,
	codec: str.optional(),
	index: num.optional(),
	selected: bool.optional(),
	default: bool.optional(),
	forced: bool.optional(),
	language: str.optional(),
	languageCode: str.optional(),
	languageTag: str.optional(),
	title: str.optional(),
	displayTitle: str.optional(),
	extendedDisplayTitle: str.optional(),
	channels: num.optional(),
	audioChannelLayout: str.optional(),
	bitrate: num.optional(),
	key: str.optional(),
	format: str.optional(),
	DOVIPresent: bool.optional(),
	colorTrc: str.optional(),
	colorPrimaries: str.optional(),
	bitDepth: num.optional(),
	profile: str.optional(),
	width: num.optional(),
	height: num.optional(),
	hearingImpaired: bool.optional()
});

export const partSchema = z.looseObject({
	/** Absent on Live TV guide airings. */
	id: num.optional(),
	key: str.optional(),
	duration: num.optional(),
	file: str.optional(),
	size: num.optional(),
	container: str.optional(),
	accessible: bool.optional(),
	exists: bool.optional(),
	/** "sd" when PMS has generated preview thumbnails (BIF) for the part. */
	indexes: str.optional(),
	Stream: z.array(streamSchema).optional()
});

export const mediaSchema = z.looseObject({
	id: num,
	duration: num.optional(),
	bitrate: num.optional(),
	width: num.optional(),
	height: num.optional(),
	videoResolution: str.optional(),
	videoCodec: str.optional(),
	videoProfile: str.optional(),
	audioCodec: str.optional(),
	audioChannels: num.optional(),
	audioProfile: str.optional(),
	container: str.optional(),
	title: str.optional(),
	/** Live TV airings (guide items). */
	beginsAt: num.optional(),
	endsAt: num.optional(),
	channelTitle: str.optional(),
	channelCallSign: str.optional(),
	channelIdentifier: str.optional(),
	channelVcn: str.optional(),
	channelThumb: str.optional(),
	Part: z.array(partSchema).optional()
});

export const markerSchema = z.looseObject({
	id: num.optional(),
	type: str,
	startTimeOffset: num,
	endTimeOffset: num,
	final: bool.optional()
});

export const chapterSchema = z.looseObject({
	id: num.optional(),
	index: num.optional(),
	tag: str.optional(),
	startTimeOffset: num,
	endTimeOffset: num,
	thumb: str.optional()
});

const ratingSchema = z.looseObject({ image: str, value: num, type: str });

/** Any library item: movie, show, season, episode, collection, playlist, clip (extra). */
export const metadataSchema = z.looseObject({
	ratingKey: str,
	key: str.optional(),
	type: str,
	subtype: str.optional(),
	extraType: num.optional(),
	title: str,
	titleSort: str.optional(),
	originalTitle: str.optional(),
	summary: str.optional(),
	tagline: str.optional(),
	year: num.optional(),
	index: num.optional(),
	parentIndex: num.optional(),
	parentTitle: str.optional(),
	parentRatingKey: str.optional(),
	parentThumb: str.optional(),
	grandparentTitle: str.optional(),
	grandparentRatingKey: str.optional(),
	grandparentThumb: str.optional(),
	grandparentArt: str.optional(),
	thumb: str.optional(),
	art: str.optional(),
	/** Playlists have a generated mosaic instead of a thumb. */
	composite: str.optional(),
	duration: num.optional(),
	viewOffset: num.optional(),
	viewCount: num.optional(),
	lastViewedAt: num.optional(),
	leafCount: num.optional(),
	viewedLeafCount: num.optional(),
	childCount: num.optional(),
	contentRating: str.optional(),
	rating: num.optional(),
	audienceRating: num.optional(),
	studio: str.optional(),
	addedAt: num.optional(),
	originallyAvailableAt: str.optional(),
	librarySectionID: num.optional(),
	librarySectionTitle: str.optional(),
	smart: bool.optional(),
	playlistType: str.optional(),
	Genre: z.array(tagSchema).optional(),
	Director: z.array(tagSchema).optional(),
	Writer: z.array(tagSchema).optional(),
	Role: z.array(tagSchema).optional(),
	Country: z.array(tagSchema).optional(),
	Rating: z.array(ratingSchema).optional(),
	Media: z.array(mediaSchema).optional(),
	Marker: z.array(markerSchema).optional(),
	Chapter: z.array(chapterSchema).optional(),
	get Extras() {
		return z.looseObject({ Metadata: z.array(metadataSchema).optional() }).optional();
	}
});

export const sectionSchema = z.looseObject({
	key: str,
	type: str,
	title: str,
	art: str.optional(),
	thumb: str.optional(),
	hidden: num.optional()
});

export const hubSchema = z.looseObject({
	hubIdentifier: str,
	title: str,
	type: str.optional(),
	size: num.optional(),
	more: bool.optional(),
	key: str.optional(),
	Metadata: z.array(metadataSchema).optional(),
	Directory: z
		.array(
			z.looseObject({
				id: num.optional(),
				tag: str.optional(),
				title: str.optional(),
				thumb: str.optional()
			})
		)
		.optional()
});

const directorySchema = z.looseObject({ key: str, title: str, size: num.optional() });

export const containerSchema = z.object({
	MediaContainer: z.looseObject({
		size: num.optional(),
		totalSize: num.optional(),
		offset: num.optional(),
		title1: str.optional(),
		title2: str.optional(),
		Metadata: z.array(metadataSchema).optional(),
		Directory: z.array(directorySchema).optional(),
		Hub: z.array(hubSchema).optional()
	})
});

export const sectionsSchema = z.object({
	MediaContainer: z.looseObject({ Directory: z.array(sectionSchema).optional() })
});

export const identitySchema = z.object({
	MediaContainer: z.looseObject({
		machineIdentifier: str,
		version: str,
		claimed: bool.optional()
	})
});

export const serverRootSchema = z.object({
	MediaContainer: z.looseObject({
		friendlyName: str.optional(),
		machineIdentifier: str,
		version: str,
		myPlex: bool.optional(),
		livetv: num.optional()
	})
});

export type RawMetadata = z.output<typeof metadataSchema>;
export type RawStream = z.output<typeof streamSchema>;
export type RawMedia = z.output<typeof mediaSchema>;
