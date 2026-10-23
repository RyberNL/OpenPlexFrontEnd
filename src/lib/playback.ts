/** Playback types and helpers shared by the browser and the server. */

/** What the browser can decode, reported with each play request. */
export type Capabilities = {
	/** Containers the <video> element can play directly (mp4, webm, mkv…). */
	containers: string[];
	/** Video codecs (Plex names: h264, hevc, av1, vp9). */
	video: string[];
	/** Audio codecs (Plex names: aac, ac3, eac3, opus, flac, mp3). */
	audio: string[];
	/** Whether the display/browser can show HDR. */
	hdr: boolean;
	/** Safari-style native HLS in <video>. */
	nativeHls: boolean;
	/** Media Source Extensions (hls.js). */
	mse: boolean;
};

export const QUALITY_PRESETS = {
	original: { label: 'Original', maxVideoBitrate: undefined, resolution: undefined },
	'1080p-20': { label: '1080p · 20 Mbps', maxVideoBitrate: 20000, resolution: '1920x1080' },
	'1080p-12': { label: '1080p · 12 Mbps', maxVideoBitrate: 12000, resolution: '1920x1080' },
	'1080p-8': { label: '1080p · 8 Mbps', maxVideoBitrate: 8000, resolution: '1920x1080' },
	'720p-4': { label: '720p · 4 Mbps', maxVideoBitrate: 4000, resolution: '1280x720' },
	'720p-3': { label: '720p · 3 Mbps', maxVideoBitrate: 3000, resolution: '1280x720' },
	'720p-2': { label: '720p · 2 Mbps', maxVideoBitrate: 2000, resolution: '1280x720' },
	'480p-1.5': { label: '480p · 1.5 Mbps', maxVideoBitrate: 1500, resolution: '720x480' },
	'360p-0.7': { label: '360p · 0.7 Mbps', maxVideoBitrate: 700, resolution: '640x360' },
	'240p-0.32': { label: '240p · 0.32 Mbps', maxVideoBitrate: 320, resolution: '426x240' }
} as const;
export type Quality = keyof typeof QUALITY_PRESETS;

export function isQuality(value: unknown): value is Quality {
	return typeof value === 'string' && value in QUALITY_PRESETS;
}

/** How a stream reaches the browser. */
export type PlaybackMethod = 'directplay' | 'directstream' | 'transcode';

export const METHOD_LABELS: Record<PlaybackMethod, string> = {
	directplay: 'Direct play',
	directstream: 'Direct stream',
	transcode: 'Transcode'
};
