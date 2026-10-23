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
 * Attaches a stream to a <video> element: direct file, hls.js (MSE) or native HLS (Safari).
 * Returns a detach function.
 */
export async function attachStream(
	video: HTMLVideoElement,
	stream: StreamInfo,
	onFatal: (message: string) => void
): Promise<() => void> {
	const startSeconds = Math.max(0, (stream.startAt - stream.streamOffset) / 1000);

	if (stream.kind === 'file') {
		video.src = stream.src;
		const seek = () => {
			if (startSeconds) video.currentTime = startSeconds;
		};
		video.addEventListener('loadedmetadata', seek, { once: true });
		return () => {
			video.removeEventListener('loadedmetadata', seek);
			video.removeAttribute('src');
			video.load();
		};
	}

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

	if (video.canPlayType('application/vnd.apple.mpegurl')) {
		video.src = stream.src;
		const seek = () => {
			if (startSeconds) video.currentTime = startSeconds;
		};
		video.addEventListener('loadedmetadata', seek, { once: true });
		return () => {
			video.removeEventListener('loadedmetadata', seek);
			video.removeAttribute('src');
			video.load();
		};
	}

	onFatal('This browser cannot play video streams.');
	return () => {};
}

const LOAD_POLICY = {
	maxTimeToFirstByteMs: 8_000,
	maxLoadTimeMs: 20_000,
	timeoutRetry: { maxNumRetry: 1, retryDelayMs: 0, maxRetryDelayMs: 0 },
	errorRetry: { maxNumRetry: 2, retryDelayMs: 1_000, maxRetryDelayMs: 3_000 }
};

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];
