import type { Capabilities } from './playback';

/** MIME probes per Plex codec name. */
const VIDEO_PROBES: Record<string, string[]> = {
	h264: ['video/mp4; codecs="avc1.640028"'],
	hevc: ['video/mp4; codecs="hvc1.1.6.L120.90"', 'video/mp4; codecs="hev1.1.6.L120.90"'],
	av1: ['video/mp4; codecs="av01.0.08M.08"'],
	vp9: ['video/webm; codecs="vp9"', 'video/mp4; codecs="vp09.00.10.08"']
};

const AUDIO_PROBES: Record<string, string[]> = {
	aac: ['audio/mp4; codecs="mp4a.40.2"'],
	mp3: ['audio/mpeg', 'audio/mp4; codecs="mp4a.6B"'],
	ac3: ['audio/mp4; codecs="ac-3"'],
	eac3: ['audio/mp4; codecs="ec-3"'],
	opus: ['audio/webm; codecs="opus"', 'audio/mp4; codecs="opus"'],
	flac: ['audio/mp4; codecs="flac"', 'audio/flac']
};

const CONTAINER_PROBES: Record<string, string> = {
	mp4: 'video/mp4',
	m4v: 'video/mp4',
	mov: 'video/quicktime',
	webm: 'video/webm',
	mkv: 'video/x-matroska'
};

/** Probes what this browser can play. Runs in the browser only. */
export function probeCapabilities(): Capabilities {
	const video = document.createElement('video');
	const mse =
		typeof MediaSource !== 'undefined' && typeof MediaSource.isTypeSupported === 'function';
	const supported = (type: string) =>
		(mse && MediaSource.isTypeSupported(type)) || video.canPlayType(type) === 'probably';
	const pick = (probes: Record<string, string[]>) =>
		Object.entries(probes)
			.filter(([, types]) => types.some(supported))
			.map(([codec]) => codec);

	return {
		containers: Object.entries(CONTAINER_PROBES)
			.filter(([, type]) => video.canPlayType(type) !== '')
			.map(([container]) => container),
		video: pick(VIDEO_PROBES),
		audio: pick(AUDIO_PROBES),
		hdr: matchMedia('(dynamic-range: high)').matches,
		nativeHls: video.canPlayType('application/vnd.apple.mpegurl') !== '',
		mse
	};
}
