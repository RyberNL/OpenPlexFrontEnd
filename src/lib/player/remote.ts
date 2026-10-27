/** AirPlay, picture-in-picture and the system's media controls, for both players. */

/**
 * The playback's stream as a URL that works without the session cookie (see
 * /api/playback/[id]/cast), for AirPlay and Chromecast; null if it can't be had.
 */
export async function castSource(playbackId: string) {
	const response = await fetch(`/api/playback/${playbackId}/cast`, { method: 'POST' }).catch(
		() => null
	);
	return response?.ok ? ((await response.json()) as { src: string; contentType: string }) : null;
}

type WebKitVideo = HTMLVideoElement & {
	webkitShowPlaybackTargetPicker?: () => void;
	webkitCurrentPlaybackTargetIsWireless?: boolean;
	webkitSupportsPresentationMode?: (mode: string) => boolean;
	webkitSetPresentationMode?: (mode: string) => void;
	webkitPresentationMode?: string;
};

type AvailabilityEvent = Event & { availability?: 'available' | 'not-available' };

/**
 * Follows whether AirPlay devices are around and whether the video is playing on one (Safari only;
 * never called back elsewhere). Returns a function that stops watching.
 */
export function watchAirPlay(
	video: HTMLVideoElement,
	onChange: (state: { available: boolean; active: boolean }) => void
) {
	const v = video as WebKitVideo;
	let available = false;
	const update = () => onChange({ available, active: !!v.webkitCurrentPlaybackTargetIsWireless });
	const onAvailability = (event: Event) => {
		available = (event as AvailabilityEvent).availability === 'available';
		update();
	};
	video.addEventListener('webkitplaybacktargetavailabilitychanged', onAvailability);
	video.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', update);
	return () => {
		video.removeEventListener('webkitplaybacktargetavailabilitychanged', onAvailability);
		video.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', update);
	};
}

export function showAirPlayPicker(video: HTMLVideoElement) {
	(video as WebKitVideo).webkitShowPlaybackTargetPicker?.();
}

/** Whether picture-in-picture works here: the standard API, or Safari's presentation modes. */
export function pipSupported() {
	if (typeof document === 'undefined') return false;
	if ('pictureInPictureEnabled' in document && document.pictureInPictureEnabled) return true;
	const probe = document.createElement('video') as WebKitVideo;
	return !!probe.webkitSupportsPresentationMode?.('picture-in-picture');
}

/** Whether the video is in picture in picture (either API). */
function inPip(video: HTMLVideoElement) {
	return (
		document.pictureInPictureElement === video ||
		(video as WebKitVideo).webkitPresentationMode === 'picture-in-picture'
	);
}

/**
 * Switches picture in picture on or off. Resolves with false when it was asked for but didn't
 * start: iOS ignores the request silently in an app added to the Home Screen.
 */
export async function togglePip(video: HTMLVideoElement): Promise<boolean> {
	const v = video as WebKitVideo;
	if (inPip(video)) {
		if (document.pictureInPictureElement) await document.exitPictureInPicture().catch(() => {});
		else v.webkitSetPresentationMode?.('inline');
		return true;
	}
	// Called straight from the tap: iOS refuses picture in picture without a user gesture.
	if (v.webkitSupportsPresentationMode?.('picture-in-picture')) {
		v.webkitSetPresentationMode!('picture-in-picture');
	} else if ('pictureInPictureEnabled' in document && document.pictureInPictureEnabled) {
		await video.requestPictureInPicture().catch(() => {});
	}
	for (let waited = 0; waited < 1500 && !inPip(video); waited += 100) {
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return inPip(video);
}

/** Why picture in picture didn't start, for the message the player shows. */
export function pipFailureMessage() {
	const homeScreenApp = (navigator as Navigator & { standalone?: boolean }).standalone === true;
	return homeScreenApp
		? 'Picture in picture doesn’t work in the Home Screen app on iPhone. Open the site in Safari to use it.'
		: 'Picture in picture could not be started.';
}

/**
 * Lets playback go on in a floating window when the user leaves the page or app while it plays:
 * Safari's automatic picture-in-picture, and Chrome's (which asks the page through Media Session).
 */
export function allowAutoPip(video: HTMLVideoElement) {
	video.setAttribute('autopictureinpicture', '');
	setActionHandler('enterpictureinpicture', () => void togglePip(video));
}

export type MediaControls = {
	title: string;
	artist?: string;
	artwork?: string;
	play: () => void;
	pause: () => void;
	/** Relative seek in seconds; absent for streams that can't seek. */
	skip?: (seconds: number) => void;
	/** Absolute seek in seconds. */
	seekTo?: (seconds: number) => void;
};

/**
 * What the lock screen, notification shade and headset buttons show and control, so playback can
 * be followed and paused while the app is in the background.
 */
export function setMediaControls(controls: MediaControls) {
	if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
	navigator.mediaSession.metadata = new MediaMetadata({
		title: controls.title,
		artist: controls.artist ?? '',
		artwork: controls.artwork ? [{ src: controls.artwork }] : []
	});
	setActionHandler('play', controls.play);
	setActionHandler('pause', controls.pause);
	const { skip, seekTo } = controls;
	setActionHandler('seekbackward', skip && ((d) => skip(-(d.seekOffset ?? 10))));
	setActionHandler('seekforward', skip && ((d) => skip(d.seekOffset ?? 10)));
	setActionHandler('seekto', seekTo && ((d) => d.seekTime !== undefined && seekTo(d.seekTime)));
}

export function clearMediaControls() {
	if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
	navigator.mediaSession.metadata = null;
	for (const action of [
		'play',
		'pause',
		'seekbackward',
		'seekforward',
		'seekto',
		'enterpictureinpicture'
	] as const) {
		setActionHandler(action, undefined);
	}
}

function setActionHandler(
	action: MediaSessionAction | 'enterpictureinpicture',
	handler: ((details: MediaSessionActionDetails) => void) | undefined
) {
	if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
	try {
		navigator.mediaSession.setActionHandler(action as MediaSessionAction, handler ?? null);
	} catch {
		// Actions this browser doesn't know (e.g. enterpictureinpicture before Chrome 120).
	}
}
