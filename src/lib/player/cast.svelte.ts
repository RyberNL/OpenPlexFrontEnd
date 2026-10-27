/**
 * Chromecast through Google's Cast sender library (Chrome only, on desktop and Android). The TV runs
 * Google's default media receiver, which fetches the stream itself from a cast URL.
 */

const SDK_URL = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';

/** The parts of the Cast sender API this player uses. */
type RemotePlayer = {
	isConnected: boolean;
	isPaused: boolean;
	currentTime: number;
	duration: number;
	playerState: string | null;
};
type RemotePlayerController = {
	addEventListener(type: string, listener: () => void): void;
	playOrPause(): void;
	seek(): void;
	stop(): void;
};
type CastSession = {
	getCastDevice(): { friendlyName: string };
	loadMedia(request: unknown): Promise<unknown>;
	getMediaSession(): { idleReason?: string | null } | null;
};
type CastContext = {
	setOptions(options: Record<string, unknown>): void;
	addEventListener(type: string, listener: (event: { castState?: string }) => void): void;
	getCastState(): string;
	getCurrentSession(): CastSession | null;
	requestSession(): Promise<unknown>;
	endCurrentSession(stopCasting: boolean): void;
};
type CastFramework = {
	CastContext: { getInstance(): CastContext };
	RemotePlayer: new () => RemotePlayer;
	RemotePlayerController: new (player: RemotePlayer) => RemotePlayerController;
	CastContextEventType: { CAST_STATE_CHANGED: string };
	RemotePlayerEventType: { ANY_CHANGE: string };
	CastState: { NO_DEVICES_AVAILABLE: string; CONNECTED: string };
};
type ChromeCast = {
	AutoJoinPolicy: { ORIGIN_SCOPED: string };
	Image: new (url: string) => unknown;
	media: {
		DEFAULT_MEDIA_RECEIVER_APP_ID: string;
		MediaInfo: new (contentId: string, contentType: string) => Record<string, unknown>;
		GenericMediaMetadata: new () => Record<string, unknown>;
		LoadRequest: new (media: unknown) => Record<string, unknown>;
		StreamType: { BUFFERED: string; LIVE: string };
		HlsSegmentFormat: { TS: string };
		HlsVideoSegmentFormat: { MPEG2_TS: string };
		IdleReason: { FINISHED: string };
	};
};
type CastWindow = Window & {
	cast?: { framework: CastFramework };
	chrome?: { cast?: ChromeCast };
	__onGCastApiAvailable?: (available: boolean) => void;
};

export type CastMedia = {
	/** Absolute URL the receiver fetches (a cast URL, see /api/playback/[id]/cast). */
	src: string;
	contentType: string;
	live?: boolean;
	/** Where to start, in seconds of the stream. */
	startAt?: number;
	title: string;
	subtitle?: string;
};

/**
 * What the Chromecast plays and how far it is. Reactive: the players read it in their templates.
 */
class Cast {
	/** Whether a Chromecast is on the network (and the library loaded). */
	available = $state(false);
	/** The connected device's name, or null when not casting. */
	device = $state<string | null>(null);
	paused = $state(true);
	/** Seconds into the stream on the TV. */
	time = $state(0);
	/** Set when the TV played the media to its end. */
	finished = $state(false);

	#context: CastContext | null = null;
	#player: RemotePlayer | null = null;
	#controller: RemotePlayerController | null = null;
	#loading: Promise<void> | null = null;

	/** Loads the sender library once, in browsers that can cast (Chrome). */
	init() {
		this.#loading ??= this.#load();
		return this.#loading;
	}

	async #load() {
		const w = window as CastWindow;
		// Only Chrome ships the Cast extension the library talks to.
		if (!('chrome' in w) || !window.isSecureContext) return;
		const ready = new Promise<boolean>((resolve) => (w.__onGCastApiAvailable = resolve));
		const script = document.createElement('script');
		script.src = SDK_URL;
		script.async = true;
		document.head.append(script);
		if (!(await ready) || !w.cast || !w.chrome?.cast) return;

		const framework = w.cast.framework;
		const chromecast = w.chrome.cast;
		const context = framework.CastContext.getInstance();
		context.setOptions({
			receiverApplicationId: chromecast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
			autoJoinPolicy: chromecast.AutoJoinPolicy.ORIGIN_SCOPED
		});
		const player = new framework.RemotePlayer();
		const controller = new framework.RemotePlayerController(player);
		this.#context = context;
		this.#player = player;
		this.#controller = controller;

		const onState = (state: string) => {
			this.available = state !== framework.CastState.NO_DEVICES_AVAILABLE;
		};
		onState(context.getCastState());
		context.addEventListener(framework.CastContextEventType.CAST_STATE_CHANGED, (e) =>
			onState(e.castState ?? '')
		);
		controller.addEventListener(framework.RemotePlayerEventType.ANY_CHANGE, () => {
			const session = context.getCurrentSession();
			this.device = player.isConnected && session ? session.getCastDevice().friendlyName : null;
			this.paused = player.isPaused;
			this.time = player.currentTime;
			this.finished =
				player.playerState === 'IDLE' &&
				session?.getMediaSession()?.idleReason === chromecast.media.IdleReason.FINISHED;
		});
	}

	/** Lets the user pick a Chromecast. Resolves with whether one is connected. */
	async connect() {
		if (!this.#context) return false;
		if (!this.#context.getCurrentSession()) {
			await this.#context.requestSession().catch(() => {});
		}
		const session = this.#context.getCurrentSession();
		this.device = session ? session.getCastDevice().friendlyName : null;
		return !!session;
	}

	async load(media: CastMedia) {
		const chromecast = (window as CastWindow).chrome?.cast;
		const session = this.#context?.getCurrentSession();
		if (!chromecast || !session) throw new Error('Not casting');
		const info = new chromecast.media.MediaInfo(media.src, media.contentType);
		info.contentUrl = media.src;
		info.streamType = media.live
			? chromecast.media.StreamType.LIVE
			: chromecast.media.StreamType.BUFFERED;
		if (media.contentType !== 'video/mp4') {
			// PMS's HLS segments are MPEG-TS; the receiver assumes fragmented MP4 otherwise.
			info.hlsSegmentFormat = chromecast.media.HlsSegmentFormat.TS;
			info.hlsVideoSegmentFormat = chromecast.media.HlsVideoSegmentFormat.MPEG2_TS;
		}
		const metadata = new chromecast.media.GenericMediaMetadata();
		metadata.title = media.title;
		if (media.subtitle) metadata.subtitle = media.subtitle;
		info.metadata = metadata;
		const request = new chromecast.media.LoadRequest(info);
		request.autoplay = true;
		if (media.startAt) request.currentTime = media.startAt;
		this.finished = false;
		this.time = media.startAt ?? 0;
		await session.loadMedia(request);
	}

	playOrPause() {
		this.#controller?.playOrPause();
	}

	/** Seeks to a time in seconds of the stream. */
	seek(seconds: number) {
		if (!this.#player || !this.#controller) return;
		this.#player.currentTime = seconds;
		this.#controller.seek();
		this.time = seconds;
	}

	/** Stops casting; the TV goes back to its home screen. */
	disconnect() {
		this.#context?.endCurrentSession(true);
		this.device = null;
	}
}

export const cast = new Cast();
