import type {
	Chapter,
	Library,
	Marker,
	MediaItem,
	MediaVersion,
	Person,
	Stream
} from '#lib/plex-types.js';
import type { RawMedia, RawMetadata, RawStream } from './schemas';

const STREAM_TYPES: Record<number, Stream['type']> = { 1: 'video', 2: 'audio', 3: 'subtitle' };

/** Plex extraType codes. */
const EXTRA_KINDS: Record<number, string> = {
	1: 'Trailer',
	2: 'Deleted scene',
	3: 'Interview',
	4: 'Music video',
	5: 'Behind the scenes',
	6: 'Scene',
	7: 'Live music video',
	8: 'Lyric music video',
	9: 'Concert',
	10: 'Featurette',
	11: 'Short',
	12: 'Other'
};

function streams(raw: RawStream[] | undefined): Stream[] {
	return (raw ?? [])
		.filter((s) => STREAM_TYPES[s.streamType])
		.map((s) => ({
			id: s.id,
			type: STREAM_TYPES[s.streamType],
			codec: s.codec,
			language: s.language,
			languageCode: s.languageCode,
			title: s.title,
			displayTitle: s.extendedDisplayTitle ?? s.displayTitle,
			selected: !!s.selected,
			default: !!s.default,
			forced: !!s.forced,
			channels: s.channels,
			bitrate: s.bitrate,
			external: !!s.key,
			format: s.format ?? s.codec
		}));
}

export function resolutionLabel(media: Pick<RawMedia, 'videoResolution' | 'height'>) {
	const r = media.videoResolution?.toLowerCase();
	if (r === '4k') return '4K';
	if (r === 'sd') return 'SD';
	if (r && /^\d+$/.test(r)) return `${r}p`;
	if (media.height) return media.height >= 2000 ? '4K' : `${media.height}p`;
	return undefined;
}

export function hdrLabel(video: RawStream | undefined) {
	if (!video) return undefined;
	if (video.DOVIPresent) return 'Dolby Vision';
	const title = `${video.displayTitle ?? ''} ${video.extendedDisplayTitle ?? ''}`;
	if (/HDR10\+/.test(title)) return 'HDR10+';
	if (video.colorTrc === 'smpte2084') return 'HDR10';
	if (video.colorTrc === 'arib-std-b67') return 'HLG';
	return undefined;
}

const AUDIO_CODECS: Record<string, string> = {
	truehd: 'TrueHD',
	eac3: 'DD+',
	ac3: 'AC3',
	aac: 'AAC',
	flac: 'FLAC',
	opus: 'Opus',
	mp3: 'MP3',
	pcm: 'PCM'
};

function channelLabel(channels?: number) {
	if (!channels) return '';
	if (channels === 1) return 'Mono';
	if (channels === 2) return 'Stereo';
	return `${channels - 1}.1`;
}

export function audioLabel(audio: RawStream | undefined, media?: RawMedia) {
	const codec = (audio?.codec ?? media?.audioCodec)?.toLowerCase();
	if (!codec) return undefined;
	const title = `${audio?.displayTitle ?? ''} ${audio?.extendedDisplayTitle ?? ''} ${audio?.title ?? ''}`;
	const channels = channelLabel(audio?.channels ?? media?.audioChannels);
	if (/atmos/i.test(title)) return channels ? `Atmos ${channels}` : 'Atmos';
	let name = AUDIO_CODECS[codec];
	if (codec === 'dca' || codec === 'dts') {
		const profile = (audio?.profile ?? media?.audioProfile ?? '').toLowerCase();
		name = profile.includes('ma') ? 'DTS-HD MA' : profile.includes('x') ? 'DTS:X' : 'DTS';
	}
	return [name ?? codec.toUpperCase(), channels].filter(Boolean).join(' ');
}

function version(media: RawMedia): MediaVersion {
	const allStreams = media.Part?.flatMap((p) => p.Stream ?? []) ?? [];
	const video = allStreams.find((s) => s.streamType === 1);
	const audio =
		allStreams.find((s) => s.streamType === 2 && s.selected) ??
		allStreams.find((s) => s.streamType === 2);
	return {
		id: media.id,
		duration: media.duration,
		bitrate: media.bitrate,
		width: media.width,
		height: media.height,
		container: media.container,
		videoCodec: media.videoCodec,
		audioCodec: media.audioCodec,
		resolution: resolutionLabel(media),
		hdr: hdrLabel(video),
		audio: audioLabel(audio, media),
		parts: (media.Part ?? [])
			.filter((p): p is typeof p & { id: number } => p.id !== undefined)
			.map((p) => ({
				id: p.id,
				file: p.file?.split(/[\\/]/).pop(),
				duration: p.duration,
				container: p.container,
				size: p.size,
				accessible: p.accessible !== false && p.exists !== false,
				previews: (p.indexes ?? '').split(',').includes('sd'),
				streams: streams(p.Stream)
			}))
	};
}

function people(tags: RawMetadata['Role']): Person[] {
	return (tags ?? []).map((t) => ({
		id: t.id !== undefined ? String(t.id) : null,
		name: t.tag,
		role: t.role,
		thumb: t.thumb
	}));
}

function ratingSource(image: string) {
	const source = image.split('://')[0];
	return { imdb: 'IMDb', rottentomatoes: 'Rotten Tomatoes', themoviedb: 'TMDB' }[source] ?? source;
}

function markers(raw: RawMetadata['Marker']): Marker[] {
	return (raw ?? [])
		.filter((m) => m.type === 'intro' || m.type === 'credits')
		.map((m) => ({
			type: m.type,
			start: m.startTimeOffset,
			end: m.endTimeOffset,
			final: !!m.final
		}))
		.sort((a, b) => a.start - b.start);
}

function chapters(raw: RawMetadata['Chapter']): Chapter[] {
	return (raw ?? []).map((c, i) => ({
		index: c.index ?? i + 1,
		title: c.tag,
		start: c.startTimeOffset,
		end: c.endTimeOffset,
		thumb: c.thumb
	}));
}

/** Converts a raw PMS metadata object into the app's {@link MediaItem}. */
export function toMediaItem(raw: RawMetadata): MediaItem {
	const isContainer = raw.type === 'show' || raw.type === 'season';
	const watched = isContainer
		? !!raw.leafCount && raw.viewedLeafCount === raw.leafCount
		: (raw.viewCount ?? 0) > 0 && !raw.viewOffset;
	return {
		id: raw.ratingKey,
		type: raw.type,
		title: raw.title,
		sortTitle: raw.titleSort,
		year: raw.year,
		summary: raw.summary || undefined,
		tagline: raw.tagline || undefined,
		thumb: raw.thumb ?? raw.composite,
		art: raw.art,
		duration: raw.duration,
		viewOffset: raw.viewOffset,
		watched,
		viewCount: raw.viewCount ?? 0,
		lastViewedAt: raw.lastViewedAt,
		leafCount: raw.leafCount,
		viewedLeafCount: raw.viewedLeafCount,
		childCount: raw.childCount,
		index: raw.index,
		parentIndex: raw.parentIndex,
		parentId: raw.parentRatingKey,
		parentTitle: raw.parentTitle,
		grandparentId: raw.grandparentRatingKey,
		grandparentTitle: raw.grandparentTitle,
		contentRating: raw.contentRating,
		ratings: (raw.Rating ?? []).map((r) => ({
			source: ratingSource(r.image),
			type: r.type,
			value: r.value
		})),
		studio: raw.studio,
		addedAt: raw.addedAt,
		releaseDate: raw.originallyAvailableAt,
		librarySectionId: raw.librarySectionID !== undefined ? String(raw.librarySectionID) : undefined,
		genres: (raw.Genre ?? []).map((g) => g.tag),
		directors: people(raw.Director),
		writers: people(raw.Writer),
		cast: people(raw.Role),
		versions: (raw.Media ?? []).map(version),
		markers: markers(raw.Marker),
		chapters: chapters(raw.Chapter),
		extras: (raw.Extras?.Metadata ?? []).map(toMediaItem),
		extraKind: raw.extraType !== undefined ? EXTRA_KINDS[raw.extraType] : undefined,
		smart: raw.smart
	};
}

export function toLibrary(raw: { key: string; type: string; title: string }): Library | null {
	if (raw.type !== 'movie' && raw.type !== 'show') return null;
	return { id: raw.key, type: raw.type, title: raw.title };
}
