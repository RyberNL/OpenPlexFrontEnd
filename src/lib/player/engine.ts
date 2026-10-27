import type Hls from 'hls.js';

export type StreamInfo = {
	playbackId: string;
	src: string;
	kind: 'file' | 'hls';
	/** Item time (ms) at which the stream's time 0 lies. */
	streamOffset: number;
	/** Item time (ms) to start at. */
	startAt: number;
};

/**
 * Safari: AirPlay can hand a stream to the TV only when the browser plays it itself from a URL,
 * not through hls.js (Media Source), so HLS plays natively there.
 */
export function prefersNativeHls() {
	return typeof window !== 'undefined' && 'WebKitPlaybackTargetAvailabilityEvent' in window;
}

/**
 * Attaches a stream to a <video> element: direct file, hls.js (MSE) or native HLS (Safari).
 * Returns a detach function.
 */
export async function attachStream(
	video: HTMLVideoElement,
	stream: StreamInfo,
	onFatal: (message: string) => void
): Promise<() => void> {
	const startSeconds = Math.max(0, (stream.startAt - stream.streamOffset) / 1000);

	if (stream.kind === 'file') return attachNative(video, stream.src, startSeconds, onFatal);

	const native = video.canPlayType('application/vnd.apple.mpegurl') !== '';
	if (native && prefersNativeHls()) return attachNative(video, stream.src, startSeconds, onFatal);

	const { default: HlsClass } = await import('hls.js');
	if (HlsClass.isSupported()) {
		const hls: Hls = new HlsClass({
			startPosition: startSeconds,
			// Segments come from our relay with the session cookie.
			xhrSetup: (xhr) => {
				xhr.withCredentials = true;
			},
			maxBufferLength: 30,
			// Give up within ~10 s on a dead connection so the user sees "interrupted" + Retry
			// instead of a frozen picture.
			fragLoadPolicy: { default: LOAD_POLICY },
			playlistLoadPolicy: { default: LOAD_POLICY },
			manifestLoadPolicy: { default: LOAD_POLICY }
		});
		hls.on(HlsClass.Events.ERROR, (_event, data) => {
			if (data.fatal) {
				onFatal(
					data.type === HlsClass.ErrorTypes.NETWORK_ERROR
						? 'The stream was interrupted.'
						: 'The stream could not be played.'
				);
			}
		});
		hls.loadSource(stream.src);
		hls.attachMedia(video);
		return () => {
			hls.destroy();
			// WebKit keeps the old MediaSource around unless the element is reset, which leaves a
			// re-attached stream stuck after a retry.
			video.removeAttribute('src');
			video.load();
		};
	}

	if (native) return attachNative(video, stream.src, startSeconds, onFatal);

	onFatal('This browser cannot play video streams.');
	return () => {};
}

/** Plays a file or HLS stream with the browser's own player. */
function attachNative(
	video: HTMLVideoElement,
	src: string,
	startSeconds: number,
	onFatal: (message: string) => void
) {
	video.src = src;
	const seek = () => {
		if (startSeconds) video.currentTime = startSeconds;
	};
	const fail = () => {
		onFatal(
			video.error?.code === MediaError.MEDIA_ERR_NETWORK
				? 'The stream was interrupted.'
				: 'The stream could not be played.'
		);
	};
	video.addEventListener('loadedmetadata', seek, { once: true });
	video.addEventListener('error', fail);
	return () => {
		video.removeEventListener('loadedmetadata', seek);
		video.removeEventListener('error', fail);
		video.removeAttribute('src');
		video.load();
	};
}

const LOAD_POLICY = {
	maxTimeToFirstByteMs: 8_000,
	maxLoadTimeMs: 20_000,
	timeoutRetry: { maxNumRetry: 1, retryDelayMs: 0, maxRetryDelayMs: 0 },
	errorRetry: { maxNumRetry: 2, retryDelayMs: 1_000, maxRetryDelayMs: 3_000 }
};

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];
