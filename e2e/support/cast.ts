import type { Page } from '@playwright/test';

export type CastLoad = {
	url: string;
	contentType: string;
	streamType: string;
	currentTime?: number;
	title: string;
};

/**
 * Replaces Google's Cast sender library with a fake that has one Chromecast ("Living Room TV")
 * and records what the player asks it to play.
 */
export async function fakeChromecast(page: Page) {
	await page.addInitScript(() => {
		const w = window as unknown as { chrome?: object };
		w.chrome ??= {};
	});
	await page.route('https://www.gstatic.com/cv/js/sender/**', (route) =>
		route.fulfill({ contentType: 'text/javascript', body: `(${FAKE_SDK})();` })
	);
}

export function castLoads(page: Page): Promise<CastLoad[]> {
	return page.evaluate(() => (window as unknown as { __casts: CastLoad[] }).__casts);
}

/** The TV stops by itself (e.g. its remote's back button): the cast session ends. */
export function endCastOnTv(page: Page) {
	return page.evaluate(() => (window as unknown as { __endCast: () => void }).__endCast());
}

const FAKE_SDK = function () {
	type Fn = () => void;
	type Request = {
		media: {
			contentUrl: string;
			contentType: string;
			streamType: string;
			metadata: { title: string };
		};
		currentTime?: number;
	};
	const onPlayer: Fn[] = [];
	const player = {
		isConnected: false,
		isPaused: true,
		currentTime: 0,
		duration: 0,
		playerState: null
	};
	const notify = () => onPlayer.forEach((f) => f());
	let session: object | null = null;
	const loads: unknown[] = [];
	const ctx = {
		setOptions() {},
		addEventListener() {},
		getCastState: () => 'NOT_CONNECTED',
		getCurrentSession: () => session,
		requestSession: async () => {
			session = {
				getCastDevice: () => ({ friendlyName: 'Living Room TV' }),
				getMediaSession: () => ({ idleReason: null }),
				loadMedia: async (r: Request) => {
					loads.push({
						url: r.media.contentUrl,
						contentType: r.media.contentType,
						streamType: r.media.streamType,
						currentTime: r.currentTime,
						title: r.media.metadata.title
					});
					Object.assign(player, {
						isConnected: true,
						isPaused: false,
						currentTime: r.currentTime ?? 0
					});
					notify();
				}
			};
		},
		endCurrentSession() {
			session = null;
			player.isConnected = false;
			notify();
		}
	};
	function Constructor(this: Record<string, unknown>, ...args: unknown[]) {
		Object.assign(this, { args });
	}
	Object.assign(window, {
		__casts: loads,
		__endCast: () => ctx.endCurrentSession(),
		cast: {
			framework: {
				CastContext: { getInstance: () => ctx },
				RemotePlayer: function () {
					return player;
				},
				RemotePlayerController: function () {
					return {
						addEventListener: (_: string, f: Fn) => onPlayer.push(f),
						playOrPause() {
							player.isPaused = !player.isPaused;
							notify();
						},
						seek: notify,
						stop() {}
					};
				},
				CastContextEventType: { CAST_STATE_CHANGED: 'caststatechanged' },
				RemotePlayerEventType: { ANY_CHANGE: 'anyChanged' },
				CastState: { NO_DEVICES_AVAILABLE: 'NO_DEVICES_AVAILABLE', CONNECTED: 'CONNECTED' }
			}
		}
	});
	const chrome = (window as unknown as { chrome: Record<string, unknown> }).chrome;
	chrome.cast = {
		AutoJoinPolicy: { ORIGIN_SCOPED: 'origin_scoped' },
		Image: Constructor,
		media: {
			DEFAULT_MEDIA_RECEIVER_APP_ID: 'CC1AD845',
			MediaInfo: function (this: Record<string, unknown>, id: string, type: string) {
				Object.assign(this, { contentId: id, contentType: type });
			},
			GenericMediaMetadata: Constructor,
			LoadRequest: function (this: Record<string, unknown>, media: unknown) {
				this.media = media;
			},
			StreamType: { BUFFERED: 'BUFFERED', LIVE: 'LIVE' },
			HlsSegmentFormat: { TS: 'ts' },
			HlsVideoSegmentFormat: { MPEG2_TS: 'mpeg2_ts' },
			IdleReason: { FINISHED: 'FINISHED' }
		}
	};
	(window as unknown as { __onGCastApiAvailable?: (ok: boolean) => void }).__onGCastApiAvailable?.(
		true
	);
}.toString();
