/** Normalized Plex data shapes shared by server and UI. Image fields hold app image URLs. */

export type ItemType =
	'movie' | 'show' | 'season' | 'episode' | 'collection' | 'playlist' | 'clip' | 'person' | string;

export type Person = { id: string | null; name: string; role?: string; thumb?: string };

export type Stream = {
	id: number;
	type: 'video' | 'audio' | 'subtitle';
	codec?: string;
	language?: string;
	languageCode?: string;
	title?: string;
	displayTitle?: string;
	selected: boolean;
	default: boolean;
	forced: boolean;
	channels?: number;
	/** kbps */
	bitrate?: number;
	/** Sidecar subtitle files have their own stream URL. */
	external: boolean;
	format?: string;
};

export type Part = {
	id: number;
	/** The file's name, without the server's folders. */
	file?: string;
	duration?: number;
	container?: string;
	size?: number;
	accessible: boolean;
	/** PMS has preview thumbnails for scrubbing. */
	previews: boolean;
	streams: Stream[];
};

export type MediaVersion = {
	id: number;
	duration?: number;
	bitrate?: number;
	width?: number;
	height?: number;
	container?: string;
	videoCodec?: string;
	audioCodec?: string;
	/** "4K", "1080p", "720p", "SD"… */
	resolution?: string;
	/** "Dolby Vision", "HDR10+", "HDR10", "HLG" or undefined for SDR. */
	hdr?: string;
	/** "Atmos", "TrueHD 7.1", "DTS-HD MA 5.1", "AC3 5.1"… */
	audio?: string;
	parts: Part[];
};

export type Marker = {
	type: 'intro' | 'credits' | string;
	start: number;
	end: number;
	final: boolean;
};
export type Chapter = { index: number; title?: string; start: number; end: number; thumb?: string };
export type Rating = { source: string; type: 'critic' | 'audience' | string; value: number };

export type MediaItem = {
	id: string;
	type: ItemType;
	title: string;
	sortTitle?: string;
	year?: number;
	summary?: string;
	tagline?: string;
	thumb?: string;
	/** Episodes: the show's poster, for places that show every item as a poster. */
	poster?: string;
	art?: string;
	duration?: number;
	viewOffset?: number;
	watched: boolean;
	viewCount: number;
	lastViewedAt?: number;
	/** Episodes (shows/seasons): total and watched. */
	leafCount?: number;
	viewedLeafCount?: number;
	childCount?: number;
	index?: number;
	parentIndex?: number;
	parentId?: string;
	parentTitle?: string;
	grandparentId?: string;
	grandparentTitle?: string;
	contentRating?: string;
	ratings: Rating[];
	studio?: string;
	addedAt?: number;
	releaseDate?: string;
	librarySectionId?: string;
	genres: string[];
	directors: Person[];
	writers: Person[];
	cast: Person[];
	versions: MediaVersion[];
	markers: Marker[];
	chapters: Chapter[];
	extras: MediaItem[];
	/** Trailer, deleted scene, featurette… for extras. */
	extraKind?: string;
	smart?: boolean;
};

export type Library = { id: string; type: 'movie' | 'show'; title: string };

export type Hub = { id: string; title: string; type?: string; more: boolean; items: MediaItem[] };

export type Page<T> = { items: T[]; offset: number; total: number };

/** A Live TV channel of the DVR's lineup. */
export type LiveChannel = {
	/** Channel identifier, as used by guide airings and for tuning. */
	id: string;
	/** Channel number as shown to users. */
	number: string;
	title: string;
	logo?: string;
};

/** One airing of a program on a channel, from the guide. */
export type Airing = {
	/** Unique per airing (a program can air several times). */
	id: string;
	/** The program, for its details. */
	programKey: string;
	channelId: string;
	title: string;
	/** Episode title for shows. */
	subtitle?: string;
	season?: number;
	episode?: number;
	type: string;
	/** The guide's first category (genre) for the program, when it provides one. */
	category?: string;
	summary?: string;
	year?: number;
	beginsAt: number;
	endsAt: number;
	thumb?: string;
};

/** A Live TV guide airing. */
export type Program = {
	id: string;
	title: string;
	subtitle?: string;
	type: string;
	channel?: string;
	beginsAt: number;
	endsAt: number;
	thumb?: string;
};

export type SearchResults = {
	movies: MediaItem[];
	shows: MediaItem[];
	episodes: MediaItem[];
	people: Person[];
	collections: MediaItem[];
	programs: Program[];
};
