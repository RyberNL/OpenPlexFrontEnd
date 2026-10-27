<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { probeCapabilities } from '#lib/capabilities.js';
	import Icon from '#lib/components/Icon.svelte';
	import { formatTimestamp, watchHref } from '#lib/media.js';
	import type { Marker, MediaItem } from '#lib/plex-types.js';
	import { QUALITY_PRESETS, type Quality } from '#lib/playback.js';
	import type { Prefs } from '#lib/server/prefs.js';
	import { deviceId } from './device';
	import { cast } from './cast.svelte';
	import { attachStream, prefersNativeHls, SPEEDS, type StreamInfo } from './engine';
	import {
		allowAutoPip,
		castSource,
		clearMediaControls,
		pipSupported as canPip,
		setMediaControls,
		showAirPlayPicker,
		pipFailureMessage,
		togglePip,
		watchAirPlay
	} from './remote';
	import AssSubtitles from './AssSubtitles.svelte';
	import FileInfo from './FileInfo.svelte';
	import PgsSubtitles from './PgsSubtitles.svelte';
	import SubtitleOverlay from './SubtitleOverlay.svelte';

	type StartResponse = StreamInfo & {
		method: string;
		methodLabel: string;
		reason?: string;
		quality: Quality;
		versionId: number;
		subtitle: { streamId: number; codec: string; url: string } | null;
		previews: string | null;
		item: MediaItem;
	};

	let {
		ratingKey,
		from = 'start',
		version,
		queue,
		prefs,
		onBack
	}: {
		ratingKey: string;
		from?: 'resume' | 'start';
		version?: number;
		/** The play queue this item was started from (watch URL parameters, see queue.ts). */
		queue?: { queue: string; shuffle?: number; pos?: number };
		prefs: Prefs;
		onBack: () => void;
	} = $props();

	let container: HTMLDivElement | undefined = $state();
	let video: HTMLVideoElement | undefined = $state();
	let info = $state<StartResponse | null>(null);
	let error = $state<string | null>(null);
	let loading = $state(true);

	let playing = $state(false);
	let streamTime = $state(0); // seconds within the current stream
	let streamDuration = $state(0); // seconds of the current stream
	let volume = $state(1);
	let muted = $state(false);
	let speed = $state(1);
	let fullscreen = $state(false);
	let controlsVisible = $state(true);
	let speedMenu = $state(false);
	let qualityMenu = $state(false);
	let audioMenu = $state(false);
	let subtitleMenu = $state(false);
	let chapterMenu = $state(false);
	let fileInfo = $state(false);
	/** Item time (ms) under the pointer on the seek bar. */
	let hoverTime = $state<number | null>(null);
	/** The last subtitle that was on, for the "c" toggle. */
	let lastSubtitle: number | null = null;
	let streamKey = $state(0);
	// svelte-ignore state_referenced_locally
	let simpleSubtitles = $state(prefs.simpleSubtitles);
	/** The subtitle URL that JASSUB failed on; it shows as simple subtitles instead. */
	let assFailedFor = $state<string | null>(null);
	/** The browser couldn't draw the PGS file; the server burns it in until the subtitle changes. */
	let burnSubtitles = false;
	// svelte-ignore state_referenced_locally
	let quality = $state<Quality>(prefs.quality);
	let scrubbing = $state<number | null>(null);
	let skipFlash = $state<{ side: 'left' | 'right'; at: number } | null>(null);
	/** After an automatic skip: what was skipped, so the user can go back. */
	let skipNotice = $state<{ marker: Marker; at: number } | null>(null);
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;
	/** Markers already skipped automatically (by start), so going back doesn't skip again. */
	// Bookkeeping only; deliberately not reactive.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const autoSkipped = new Set<number>();
	/** The episode after this one: undefined until asked for, null when there is none. */
	let nextUp = $state<MediaItem | null | undefined>(undefined);
	let nextPos: number | undefined;
	let nextPrompt = $state(false);
	/** Seconds until the next item starts by itself (autoplay); null when not counting down. */
	let countdown = $state<number | null>(null);
	let countdownTimer: ReturnType<typeof setInterval> | undefined;

	let detach: (() => void) | undefined;
	let hideTimer: ReturnType<typeof setTimeout> | undefined;

	/** Item time in ms. */
	const position = $derived(scrubbing ?? (info ? info.streamOffset + streamTime * 1000 : 0));
	const duration = $derived(
		info
			? Math.max(
					streamDuration ? info.streamOffset + streamDuration * 1000 : 0,
					info.kind === 'hls' ? (info.item.duration ?? 0) : 0
				)
			: 0
	);
	/** The intro or credits marker playback is in (until a second before its end). */
	const activeMarker = $derived(
		scrubbing === null
			? info?.item.markers.find(
					(m) =>
						(m.type === 'intro' || m.type === 'credits') &&
						position >= m.start &&
						position < m.end - 1000
				)
			: undefined
	);

	$effect(() => {
		const marker = activeMarker;
		if (!marker || autoSkipped.has(marker.start) || loading) return;
		const auto = marker.type === 'intro' ? prefs.autoSkipIntro : prefs.autoSkipCredits;
		if (!auto) return;
		autoSkipped.add(marker.start);
		skipMarker(marker, true);
	});

	const chapters = $derived(info?.item.chapters ?? []);
	const currentChapter = $derived(chapters.findLast((c) => c.start <= position));
	/** The time the seek bar preview shows: where the user drags, else where they point. */
	const previewTime = $derived(scrubbing ?? hoverTime);
	const previewChapter = $derived(
		previewTime === null ? undefined : chapters.findLast((c) => c.start <= previewTime)
	);

	function chapterLabel(chapter: { index: number; title?: string }) {
		return chapter.title || `Chapter ${chapter.index}`;
	}

	function onSeekHover(event: PointerEvent) {
		if (!duration) return;
		const bar = event.currentTarget as HTMLElement;
		const rect = bar.getBoundingClientRect();
		const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
		hoverTime = ratio * duration;
	}

	const title = $derived.by(() => {
		const item = info?.item;
		if (!item) return '';
		return item.type === 'episode' ? (item.grandparentTitle ?? item.title) : item.title;
	});
	const subtitleLine = $derived.by(() => {
		const item = info?.item;
		if (!item || item.type !== 'episode') return '';
		return `S${item.parentIndex} · E${item.index} — ${item.title}`;
	});
	const pipSupported = canPip();
	/** Why picture in picture didn't start, shown for a while. */
	let pipNotice = $state<string | null>(null);

	async function pip() {
		if (!video || (await togglePip(video))) return;
		pipNotice = pipFailureMessage();
		setTimeout(() => (pipNotice = null), 8_000);
	}
	/** AirPlay devices around (Safari), and whether the video plays on one. */
	let airplay = $state({ available: false, active: false });
	/** This player's video plays on a Chromecast (see startCasting). */
	let castingHere = $state(false);

	/** What Google's default receiver plays on every Chromecast. */
	const CAST_CAPS = {
		containers: ['mp4', 'm4v'],
		video: ['h264'],
		audio: ['aac', 'mp3'],
		hdr: false,
		nativeHls: false,
		mse: true
	};

	$effect(() => {
		if (!video) return;
		allowAutoPip(video);
		return watchAirPlay(video, (state) => (airplay = state));
	});

	// Lock screen and notification controls, so playback can go on in the background.
	$effect(() => {
		if (!info) return;
		setMediaControls({
			title,
			artist: subtitleLine || undefined,
			artwork: info.item.thumb,
			play: () => (castingHere ? cast.paused && cast.playOrPause() : void video?.play()),
			pause: () => (castingHere ? !cast.paused && cast.playOrPause() : video?.pause()),
			skip,
			seekTo: (seconds) => seekTo(seconds * 1000 + (info?.streamOffset ?? 0))
		});
	});

	let reportTimer: ReturnType<typeof setInterval> | undefined;
	let ended = false;

	function timelineUrl() {
		return `/api/playback/${info!.playbackId}/timeline`;
	}

	/**
	 * Sends a progress report. `keepalive` lets it outlive the page (tab closing, navigation),
	 * like a beacon, but as JSON so it isn't treated as a cross-site form post.
	 */
	function send(state: 'playing' | 'paused' | 'buffering' | 'stopped', keepalive = false) {
		void fetch(timelineUrl(), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ state, time: Math.round(position), duration: Math.round(duration) }),
			keepalive
		}).catch(() => {});
	}

	function report(state: 'playing' | 'paused' | 'buffering' | 'stopped') {
		if (!info || ended) return;
		if (state === 'stopped') ended = true;
		send(state, state === 'stopped');
	}

	/**
	 * The page became hidden (tab switched or closing, app backgrounded): save the position. Not
	 * "stopped": the user may come back to this tab.
	 */
	function onVisibilityChange() {
		if (document.visibilityState === 'hidden') saveProgress();
	}

	/** Saves the current position in a request that survives unload, without ending playback. */
	function saveProgress() {
		if (!info || ended) return;
		send(video?.paused ? 'paused' : 'playing', true);
	}

	/** The page is being unloaded: final report. */
	function onPageHide() {
		if (!info || ended) return;
		// The TV plays on without this page; the server ends the playback once it stops.
		if (castingHere) return saveProgress();
		ended = true;
		send('stopped', true);
	}

	async function start(options: { offset?: number } = {}) {
		loading = true;
		error = null;
		detach?.();
		if (info) {
			// Replaced by a new stream (e.g. seeking before its start): discard without "stopped".
			void fetch(`/api/playback/${info.playbackId}`, { method: 'DELETE' }).catch(() => {});
		}
		ended = false;
		const response = await fetch('/api/playback', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				ratingKey,
				from,
				version,
				offset: options.offset,
				quality,
				// The default receiver shows no subtitles of its own: they come burned in.
				burnSubtitles: burnSubtitles || (castingHere && subtitleOn),
				caps: castingHere ? CAST_CAPS : probeCapabilities(),
				deviceId: deviceId()
			})
		}).catch(() => null);
		if (!response?.ok) {
			const body = await response?.json().catch(() => null);
			error = body?.message ?? 'Playback could not be started.';
			loading = false;
			return;
		}
		info = await response.json();
		if (castingHere) {
			await castCurrent();
			return;
		}
		if (prefersNativeHls()) {
			// AirPlay hands the URL to the TV, which fetches the stream without the session cookie.
			const source = await castSource(info!.playbackId);
			if (source) info!.src = source.src;
		}
		// A fresh <video> per stream: WebKit can get stuck re-attaching MSE to a used element.
		streamKey++;
		await tick();
		detach = await attachStream(video!, info!, (message) => (error = message));
		video!.playbackRate = speed;
		await video!.play().catch(() => {
			// Autoplay may be blocked; the play button remains available.
		});
		loading = false;
	}

	/** Picks a Chromecast and continues there, on a stream made for it, from the same position. */
	async function startCasting() {
		if (!(await cast.connect())) return;
		castingHere = true;
		video?.pause();
		await start({ offset: Math.round(position) });
	}

	/** Loads the current playback (started for the Chromecast) on the TV. */
	async function castCurrent() {
		const source = info && (await castSource(info.playbackId));
		try {
			if (!info || !source) throw new Error('No cast URL');
			await cast.load({
				...source,
				startAt: (info.startAt - info.streamOffset) / 1000,
				title: title,
				subtitle: subtitleLine || undefined
			});
		} catch {
			castingHere = false;
			cast.disconnect();
			error = 'The video could not be played on the Chromecast.';
			loading = false;
			return;
		}
		streamTime = cast.time;
		loading = false;
		clearInterval(reportTimer);
		reportTimer = setInterval(() => report(cast.paused ? 'paused' : 'playing'), 10_000);
	}

	/** Back from the Chromecast: playback continues here where the TV was. */
	function stopCasting() {
		cast.disconnect();
	}

	$effect(() => {
		if (!castingHere) return;
		if (cast.device === null) {
			// The cast session ended (here, from Chrome's menu, or on the TV).
			castingHere = false;
			clearInterval(reportTimer);
			void start({ offset: Math.round(position) });
			return;
		}
		streamTime = cast.time;
		playing = !cast.paused;
	});

	$effect(() => {
		if (!castingHere || !cast.finished) return;
		clearInterval(reportTimer);
		void promptNext().finally(() => report('stopped'));
	});

	/** Seeks to an item time (ms), restarting the stream when it lies before the stream start. */
	function seekTo(target: number) {
		if (!info) return;
		const clamped = Math.max(0, Math.min(target, duration || target));
		if (castingHere) {
			cast.seek((clamped - info.streamOffset) / 1000);
			streamTime = cast.time;
			return;
		}
		if (!video) return;
		if (info.kind === 'hls' && clamped < info.streamOffset) {
			void start({ offset: clamped });
			return;
		}
		video.currentTime = (clamped - info.streamOffset) / 1000;
		streamTime = video.currentTime;
	}

	/** Seeks past an intro or credits marker; credits of an episode lead to the next episode. */
	function skipMarker(marker: Marker, auto = false) {
		seekTo(marker.end);
		clearTimeout(noticeTimer);
		skipNotice = auto ? { marker, at: Date.now() } : null;
		if (auto) noticeTimer = setTimeout(() => (skipNotice = null), 8_000);
		if (marker.type === 'credits') void promptNext();
	}

	/** Back to the start of an automatically skipped marker (it isn't skipped again). */
	function undoSkip() {
		if (!skipNotice) return;
		seekTo(skipNotice.marker.start);
		skipNotice = null;
		closeNext();
	}

	/**
	 * Shows the "Up next" prompt when there is a next item (the play queue's, or the following
	 * episode), counting down to it when autoplay is on.
	 */
	async function promptNext() {
		if (!info || nextPrompt || (info.item.type !== 'episode' && !queue)) return;
		if (nextUp === undefined) {
			const params = queue
				? `?${new URLSearchParams(
						Object.entries(queue)
							.filter(([, v]) => v !== undefined)
							.map(([k, v]) => [k, String(v)])
					)}`
				: '';
			const response = await fetch(`/api/playback/${info.playbackId}/next${params}`).catch(
				() => null
			);
			const body = response?.ok ? await response.json() : null;
			nextUp = body?.next ?? null;
			nextPos = body?.pos ?? undefined;
		}
		if (!nextUp) return;
		nextPrompt = true;
		if (prefs.autoplayNext) {
			countdown = 10;
			clearInterval(countdownTimer);
			countdownTimer = setInterval(() => {
				if (countdown === null) return;
				countdown -= 1;
				if (countdown <= 0) playNext();
			}, 1000);
		}
	}

	/** Stops the countdown; the prompt stays so the user can still choose to play next. */
	function cancelCountdown() {
		clearInterval(countdownTimer);
		countdown = null;
	}

	function closeNext() {
		cancelCountdown();
		nextPrompt = false;
	}

	function playNext() {
		cancelCountdown();
		if (!nextUp) return;
		const href = watchHref(nextUp, {
			from: 'start',
			...(queue && { queue: queue.queue, shuffle: queue.shuffle, pos: nextPos })
		});
		// Replaces this entry, so Back from the next item returns to where playback began.
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- watchHref() uses resolve()
		void goto(href, { replace: true });
	}

	function skip(seconds: number) {
		seekTo(position + seconds * 1000);
		reveal();
	}

	function togglePlay() {
		if (castingHere) {
			cast.playOrPause();
			reveal();
			return;
		}
		if (!video) return;
		if (video.paused) void video.play();
		else video.pause();
		reveal();
	}

	function setVolume(value: number) {
		if (!video) return;
		video.volume = Math.max(0, Math.min(1, value));
		video.muted = video.volume === 0;
		reveal();
	}

	function toggleMute() {
		if (!video) return;
		video.muted = !video.muted;
		reveal();
	}

	function setSpeed(value: number) {
		speed = value;
		if (video) {
			video.playbackRate = value;
			video.preservesPitch = true;
		}
		speedMenu = false;
		reveal();
	}

	const currentVersion = $derived(
		info?.item.versions.find((v) => v.id === info?.versionId) ?? info?.item.versions[0]
	);
	const currentPart = $derived(currentVersion?.parts[0]);
	const audioTracks = $derived(currentPart?.streams.filter((s) => s.type === 'audio') ?? []);
	const subtitleTracks = $derived(currentPart?.streams.filter((s) => s.type === 'subtitle') ?? []);
	const subtitleOn = $derived(subtitleTracks.some((s) => s.selected));
	/** ASS/SSA keeps its styling (JASSUB) unless simple subtitles are chosen. */
	const styledSubtitle = $derived(['ass', 'ssa'].includes(info?.subtitle?.codec ?? ''));

	function chooseSubtitle(streamId: number) {
		subtitleMenu = false;
		const current = subtitleTracks.find((s) => s.selected)?.id ?? 0;
		if (current) lastSubtitle = current;
		if (streamId === current) return;
		void chooseStreams({ subtitleStreamId: streamId });
	}

	/** "c": subtitles off, or back on with the last (or first) track. */
	function toggleSubtitles() {
		const current = subtitleTracks.find((s) => s.selected)?.id;
		if (current) chooseSubtitle(0);
		else if (subtitleTracks.length) chooseSubtitle(lastSubtitle ?? subtitleTracks[0].id);
	}

	/** Saves an audio/subtitle choice in Plex, then continues on a stream that uses it. */
	async function chooseStreams(streams: { audioStreamId?: number; subtitleStreamId?: number }) {
		audioMenu = false;
		subtitleMenu = false;
		if (!info) return;
		if (streams.subtitleStreamId !== undefined) burnSubtitles = false;
		const response = await fetch(`/api/playback/${info.playbackId}/streams`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(streams)
		});
		if (!response.ok) {
			error = 'The track could not be changed.';
			return;
		}
		await start({ offset: Math.round(position) });
	}

	/** Switches quality, continuing from the current position on a new stream. */
	function setQuality(value: Quality) {
		qualityMenu = false;
		if (value === quality) return;
		quality = value;
		void start({ offset: Math.round(position) });
	}

	function stepSpeed(direction: 1 | -1) {
		const index = SPEEDS.indexOf(speed);
		setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, index + direction))]);
	}

	async function toggleFullscreen() {
		if (document.fullscreenElement) await document.exitFullscreen();
		else if (container?.requestFullscreen) await container.requestFullscreen().catch(() => {});
		else
			(
				video as HTMLVideoElement & { webkitEnterFullscreen?: () => void }
			)?.webkitEnterFullscreen?.();
		reveal();
	}

	/** Shows the controls, hiding them again after a while if playing. */
	function reveal() {
		controlsVisible = true;
		clearTimeout(hideTimer);
		hideTimer = setTimeout(() => {
			if (
				playing &&
				!speedMenu &&
				!qualityMenu &&
				!audioMenu &&
				!subtitleMenu &&
				!chapterMenu &&
				!fileInfo &&
				scrubbing === null
			) {
				controlsVisible = false;
			}
		}, 3000);
	}

	function onKeydown(event: KeyboardEvent) {
		const target = event.target as HTMLElement;
		if (target.closest('input, select, textarea') && target.getAttribute('type') !== 'range')
			return;
		const handled = (action: () => void) => {
			event.preventDefault();
			action();
		};
		switch (event.key) {
			case ' ':
			case 'k':
				if (target.tagName === 'BUTTON' && event.key === ' ') return;
				return handled(togglePlay);
			case 'ArrowRight':
				return handled(() => skip(10));
			case 'ArrowLeft':
				return handled(() => skip(-10));
			case 'ArrowUp':
				return handled(() => setVolume((video?.volume ?? 1) + 0.1));
			case 'ArrowDown':
				return handled(() => setVolume((video?.volume ?? 1) - 0.1));
			case 'f':
				return handled(() => void toggleFullscreen());
			case 'm':
				return handled(toggleMute);
			case ']':
				return handled(() => stepSpeed(1));
			case '[':
				return handled(() => stepSpeed(-1));
			case 'c':
				return handled(toggleSubtitles);
			case 'i':
				return handled(() => ((fileInfo = !fileInfo), reveal()));
			case 'Escape':
				if (fileInfo) return handled(() => (fileInfo = false));
				return;
		}
	}

	// Touch: tap toggles the controls; double-tap on the left/right half skips ∓/±10 s.
	let lastTap: { time: number; side: 'left' | 'right' } | null = null;
	let tapTimer: ReturnType<typeof setTimeout> | undefined;
	function onSurfacePointerUp(event: PointerEvent) {
		if (event.pointerType === 'mouse') {
			togglePlay();
			return;
		}
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const side = event.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
		const now = Date.now();
		if (lastTap && now - lastTap.time < 300 && lastTap.side === side) {
			clearTimeout(tapTimer);
			lastTap = null;
			skip(side === 'left' ? -10 : 10);
			skipFlash = { side, at: now };
			return;
		}
		lastTap = { time: now, side };
		clearTimeout(tapTimer);
		tapTimer = setTimeout(() => {
			if (controlsVisible && playing) controlsVisible = false;
			else reveal();
		}, 300);
	}

	onMount(() => {
		void cast.init();
		void start();
		const onFullscreen = () => (fullscreen = !!document.fullscreenElement);
		document.addEventListener('fullscreenchange', onFullscreen);
		return () => document.removeEventListener('fullscreenchange', onFullscreen);
	});

	onDestroy(() => {
		clearInterval(reportTimer);
		if (castingHere) cast.disconnect();
		clearMediaControls();
		report('stopped');
		detach?.();
		clearTimeout(hideTimer);
		clearTimeout(tapTimer);
		clearTimeout(noticeTimer);
		clearInterval(countdownTimer);
	});
</script>

<svelte:window onkeydown={onKeydown} onpagehide={onPageHide} onbeforeunload={saveProgress} />
<svelte:document onvisibilitychange={onVisibilityChange} />

<div
	bind:this={container}
	class="player fixed inset-0 flex items-center justify-center bg-black text-white select-none"
	class:cursor-none={!controlsVisible}
	role="application"
	aria-label="Video player"
	onpointermove={(e) => e.pointerType === 'mouse' && reveal()}
	data-testid="player"
>
	{#key streamKey}
		<video
			bind:this={video}
			class="h-full w-full object-contain"
			class:invisible={castingHere}
			playsinline
			preload="auto"
			bind:currentTime={streamTime}
			bind:duration={streamDuration}
			bind:volume
			bind:muted
			onplay={() => {
				playing = true;
				reveal();
				report('playing');
				clearInterval(reportTimer);
				reportTimer = setInterval(() => report('playing'), 10_000);
			}}
			onpause={() => {
				playing = false;
				controlsVisible = true;
				clearInterval(reportTimer);
				if (!video?.ended) report('paused');
			}}
			onseeked={() => report(video?.paused ? 'paused' : 'playing')}
			onended={() => {
				clearInterval(reportTimer);
				// "stopped" ends the playback on the server, so ask what's next first.
				void promptNext().finally(() => report('stopped'));
			}}
			data-testid="video"
		></video>
	{/key}

	{#if castingHere || airplay.active}
		<div
			class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center"
			data-testid="casting"
		>
			<Icon name={castingHere ? 'cast' : 'airplay'} size={48} class="text-white/70" />
			<p class="text-lg font-semibold">Playing on {castingHere ? cast.device : 'AirPlay'}</p>
		</div>
	{/if}

	{#if info?.subtitle && !castingHere}
		{#if info.subtitle.codec === 'pgs' && video}
			{#key video}
				<PgsSubtitles
					url={info.subtitle.url}
					{video}
					streamOffset={info.streamOffset}
					onfail={() => {
						burnSubtitles = true;
						void start({ offset: Math.round(position) });
					}}
				/>
			{/key}
		{:else if styledSubtitle && !simpleSubtitles && assFailedFor !== info.subtitle.url && video}
			{#key video}
				<AssSubtitles
					url={info.subtitle.url}
					{video}
					streamOffset={info.streamOffset}
					onfail={() => (assFailedFor = info?.subtitle?.url ?? null)}
				/>
			{/key}
		{:else}
			{#key info.subtitle.url}
				<SubtitleOverlay
					url={info.subtitle.url}
					{streamTime}
					streamOffset={info.streamOffset}
					raised={controlsVisible}
					style={{
						size: prefs.subtitleSize,
						color: prefs.subtitleColor,
						background: prefs.subtitleBackground,
						position: prefs.subtitlePosition
					}}
				/>
			{/key}
		{/if}
	{/if}

	<!-- Gesture surface between the video and the controls -->
	<div
		class="absolute inset-0"
		onpointerup={onSurfacePointerUp}
		data-testid="gesture-surface"
		aria-hidden="true"
	></div>

	{#if skipFlash}
		{#key skipFlash.at}
			<div
				class="skip-flash pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full bg-white/20 px-4 py-2 text-sm font-semibold"
				class:left-8={skipFlash.side === 'left'}
				class:right-8={skipFlash.side === 'right'}
				aria-hidden="true"
			>
				{skipFlash.side === 'left' ? '−10 s' : '+10 s'}
			</div>
		{/key}
	{/if}

	{#if loading && !error}
		<div
			class="pointer-events-none absolute inset-0 flex items-center justify-center"
			role="status"
		>
			<span class="h-12 w-12 animate-spin rounded-full border-4 border-white/30 border-t-white"
			></span>
			<span class="sr-only">Loading</span>
		</div>
	{/if}

	{#if pipNotice}
		<p
			class="absolute top-24 left-1/2 z-20 w-max max-w-[90%] -translate-x-1/2 rounded-lg bg-black/85 px-4 py-2 text-center text-sm"
			role="status"
			data-testid="pip-notice"
		>
			{pipNotice}
		</p>
	{/if}

	{#if error}
		<div class="absolute inset-0 flex items-center justify-center bg-black/80 p-6" role="alert">
			<div class="flex max-w-md flex-col items-center gap-4 text-center">
				<p class="text-lg font-semibold" data-testid="player-error">{error}</p>
				<div class="flex gap-3">
					<button class="btn btn-primary" onclick={() => start({ offset: position || undefined })}
						>Retry</button
					>
					<button class="btn btn-secondary" onclick={onBack}>Back</button>
				</div>
			</div>
		</div>
	{/if}

	<div
		class="controls pointer-events-none absolute inset-0 flex flex-col justify-between transition-opacity duration-200"
		class:opacity-0={!controlsVisible}
		data-testid="controls"
		data-visible={controlsVisible}
	>
		<div
			class="player-bar-top pointer-events-auto flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent"
		>
			<button class="ctl" aria-label="Back" onclick={onBack}><Icon name="back" /></button>
			<div class="min-w-0">
				<p class="truncate text-lg font-semibold" data-testid="player-title">{title}</p>
				{#if subtitleLine}<p class="truncate text-sm text-white/70">{subtitleLine}</p>{/if}
			</div>
			{#if info}
				<button
					class="ctl ml-auto px-3 text-sm"
					aria-label="File info"
					aria-expanded={fileInfo}
					onclick={() => ((fileInfo = !fileInfo), reveal())}>Info</button
				>
			{/if}
		</div>

		<div
			class="player-bar-bottom pointer-events-auto flex flex-col gap-2 bg-gradient-to-t from-black/90 to-transparent"
		>
			<div class="flex items-center gap-3 text-sm tabular-nums">
				<span data-testid="elapsed">{formatTimestamp(position)}</span>
				<div class="relative flex flex-1 items-center">
					{#if previewTime !== null && duration}
						<div
							class="pointer-events-none absolute bottom-12 flex -translate-x-1/2 flex-col items-center gap-1"
							style:left="clamp(4.5rem, {(previewTime / duration) * 100}%, calc(100% - 4.5rem))"
							data-testid="seek-preview"
						>
							{#if info?.previews}
								<img
									src="{info.previews}?t={Math.floor(previewTime / 2000) * 2000}"
									alt=""
									class="h-[81px] w-36 rounded border border-white/30 bg-black object-cover shadow-lg"
									data-testid="seek-thumbnail"
								/>
							{/if}
							<span class="rounded bg-black/80 px-2 py-0.5 text-xs">
								{formatTimestamp(previewTime)}{previewChapter && chapters.length > 1
									? ` · ${chapterLabel(previewChapter)}`
									: ''}
							</span>
						</div>
					{/if}
					{#each chapters as chapter (chapter.index)}
						{#if chapter.start > 0 && duration && chapter.start < duration}
							<span
								class="pointer-events-none absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 bg-white/70"
								style:left="{(chapter.start / duration) * 100}%"
								data-testid="chapter-tick"
							></span>
						{/if}
					{/each}
					<input
						type="range"
						class="seek h-11 w-full cursor-pointer accent-[var(--color-accent)]"
						aria-label="Seek"
						aria-valuetext="{formatTimestamp(position)} of {formatTimestamp(duration)}"
						min="0"
						max={Math.max(1, Math.floor(duration))}
						step="1000"
						value={Math.floor(position)}
						oninput={(e) => {
							scrubbing = Number(e.currentTarget.value);
							reveal();
						}}
						onchange={(e) => {
							scrubbing = null;
							seekTo(Number(e.currentTarget.value));
						}}
						onpointermove={onSeekHover}
						onpointerleave={() => (hoverTime = null)}
					/>
				</div>
				<span data-testid="remaining">−{formatTimestamp(Math.max(0, duration - position))}</span>
			</div>
			<div class="flex items-center gap-1 md:gap-2">
				<button class="ctl" aria-label="Back 10 seconds" onclick={() => skip(-10)}>−10</button>
				<button class="ctl" aria-label={playing ? 'Pause' : 'Play'} onclick={togglePlay}>
					<Icon name={playing ? 'close' : 'play'} />
				</button>
				<button class="ctl" aria-label="Forward 10 seconds" onclick={() => skip(10)}>+10</button>
				<button class="ctl" aria-label={muted ? 'Unmute' : 'Mute'} onclick={toggleMute}>
					{muted || volume === 0 ? '🔇' : '🔊'}
				</button>
				<input
					type="range"
					class="hidden h-11 w-24 accent-[var(--color-accent)] md:block"
					aria-label="Volume"
					min="0"
					max="1"
					step="0.05"
					value={muted ? 0 : volume}
					oninput={(e) => setVolume(Number(e.currentTarget.value))}
				/>
				<span class="flex-1"></span>
				<div class="relative">
					<button
						class="ctl px-2"
						aria-label="Playback speed"
						aria-haspopup="menu"
						aria-expanded={speedMenu}
						onclick={() => ((speedMenu = !speedMenu), reveal())}
						data-testid="speed">{speed}×</button
					>
					{#if speedMenu}
						<ul
							class="absolute right-0 bottom-12 max-h-72 overflow-y-auto rounded-lg bg-surface p-1 shadow-xl"
							role="menu"
							aria-label="Playback speed"
						>
							{#each SPEEDS as option (option)}
								<li role="none">
									<button
										role="menuitemradio"
										aria-checked={option === speed}
										class="flex min-h-11 w-24 items-center justify-center rounded hover:bg-surface-2 aria-checked:text-accent"
										onclick={() => setSpeed(option)}>{option}×</button
									>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
				{#if chapters.length > 1}
					<div class="relative">
						<button
							class="ctl px-2 text-sm"
							aria-label="Chapters"
							aria-haspopup="menu"
							aria-expanded={chapterMenu}
							onclick={() => (
								(chapterMenu = !chapterMenu),
								(audioMenu = qualityMenu = speedMenu = subtitleMenu = false),
								reveal()
							)}>Chapters</button
						>
						{#if chapterMenu}
							<ul
								class="absolute right-0 bottom-12 max-h-80 overflow-y-auto rounded-lg bg-surface p-1 shadow-xl"
								role="menu"
								aria-label="Chapters"
							>
								{#each chapters as chapter (chapter.index)}
									<li role="none">
										<button
											role="menuitemradio"
											aria-checked={chapter === currentChapter}
											class="flex min-h-11 w-72 items-center gap-3 rounded px-2 py-1 text-left hover:bg-surface-2 aria-checked:text-accent"
											onclick={() => {
												chapterMenu = false;
												seekTo(chapter.start);
												reveal();
											}}
										>
											{#if chapter.thumb}
												<img
													src={chapter.thumb}
													alt=""
													loading="lazy"
													class="h-9 w-16 shrink-0 rounded bg-black object-cover"
												/>
											{/if}
											<span class="min-w-0 flex-1 truncate">{chapterLabel(chapter)}</span>
											<span class="text-xs text-white/60 tabular-nums"
												>{formatTimestamp(chapter.start)}</span
											>
										</button>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/if}
				{#if subtitleTracks.length}
					<div class="relative">
						<button
							class="ctl px-2 text-sm"
							aria-label="Subtitles"
							aria-haspopup="menu"
							aria-expanded={subtitleMenu}
							aria-pressed={subtitleOn}
							onclick={() => (
								(subtitleMenu = !subtitleMenu),
								(audioMenu = qualityMenu = speedMenu = chapterMenu = false),
								reveal()
							)}
							data-testid="subtitles-button">CC</button
						>
						{#if subtitleMenu}
							<ul
								class="absolute right-0 bottom-12 max-h-72 overflow-y-auto rounded-lg bg-surface p-1 shadow-xl"
								role="menu"
								aria-label="Subtitles"
							>
								<li role="none">
									<button
										role="menuitemradio"
										aria-checked={!subtitleOn}
										class="flex min-h-11 w-64 items-center rounded px-3 text-left hover:bg-surface-2 aria-checked:text-accent"
										onclick={() => chooseSubtitle(0)}>Off</button
									>
								</li>
								{#each subtitleTracks as track (track.id)}
									<li role="none">
										<button
											role="menuitemradio"
											aria-checked={track.selected}
											class="flex min-h-11 w-64 items-center rounded px-3 text-left hover:bg-surface-2 aria-checked:text-accent"
											onclick={() => chooseSubtitle(track.id)}
											>{track.displayTitle ??
												track.language ??
												`Subtitle ${track.id}`}{track.external ? ' (file)' : ''}</button
										>
									</li>
								{/each}
								{#if styledSubtitle}
									<li role="separator" class="my-1 border-t border-white/10"></li>
									<li role="none">
										<button
											role="menuitemcheckbox"
											aria-checked={simpleSubtitles}
											class="flex min-h-11 w-64 items-center rounded px-3 text-left hover:bg-surface-2 aria-checked:text-accent"
											onclick={() => ((simpleSubtitles = !simpleSubtitles), (subtitleMenu = false))}
											>Simple subtitles</button
										>
									</li>
								{/if}
							</ul>
						{/if}
					</div>
				{/if}
				{#if audioTracks.length > 1}
					<div class="relative">
						<button
							class="ctl px-2 text-sm"
							aria-label="Audio"
							aria-haspopup="menu"
							aria-expanded={audioMenu}
							onclick={() => (
								(audioMenu = !audioMenu),
								(qualityMenu = speedMenu = chapterMenu = false),
								reveal()
							)}
							data-testid="audio">Audio</button
						>
						{#if audioMenu}
							<ul
								class="absolute right-0 bottom-12 max-h-72 overflow-y-auto rounded-lg bg-surface p-1 shadow-xl"
								role="menu"
								aria-label="Audio"
							>
								{#each audioTracks as track (track.id)}
									<li role="none">
										<button
											role="menuitemradio"
											aria-checked={track.selected}
											class="flex min-h-11 w-64 items-center rounded px-3 text-left hover:bg-surface-2 aria-checked:text-accent"
											onclick={() => chooseStreams({ audioStreamId: track.id })}
											>{track.displayTitle ?? track.language ?? `Track ${track.id}`}</button
										>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/if}
				<div class="relative">
					<button
						class="ctl px-2 text-sm"
						aria-label="Quality"
						aria-haspopup="menu"
						aria-expanded={qualityMenu}
						onclick={() => (
							(qualityMenu = !qualityMenu),
							(speedMenu = audioMenu = chapterMenu = false),
							reveal()
						)}
						data-testid="quality">{QUALITY_PRESETS[quality].label.split(' ')[0]}</button
					>
					{#if qualityMenu}
						<ul
							class="absolute right-0 bottom-12 max-h-72 overflow-y-auto rounded-lg bg-surface p-1 shadow-xl"
							role="menu"
							aria-label="Quality"
						>
							{#each Object.entries(QUALITY_PRESETS) as [value, preset] (value)}
								<li role="none">
									<button
										role="menuitemradio"
										aria-checked={value === quality}
										class="flex min-h-11 w-44 items-center rounded px-3 text-left hover:bg-surface-2 aria-checked:text-accent"
										onclick={() => setQuality(value as Quality)}>{preset.label}</button
									>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
				{#if airplay.available && !castingHere}
					<button
						class="ctl"
						aria-label="AirPlay"
						onclick={() => video && showAirPlayPicker(video)}
						data-testid="airplay"><Icon name="airplay" /></button
					>
				{/if}
				{#if cast.available || castingHere}
					<button
						class="ctl"
						class:text-accent={castingHere}
						aria-label={castingHere ? 'Stop casting' : 'Cast'}
						onclick={() => (castingHere ? stopCasting() : void startCasting())}
						data-testid="cast"><Icon name="cast" /></button
					>
				{/if}
				{#if pipSupported && !castingHere}
					<button class="ctl" aria-label="Picture in picture" onclick={pip}
						><Icon name="pip" /></button
					>
				{/if}
				<button
					class="ctl"
					aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
					onclick={toggleFullscreen}>{fullscreen ? '⤡' : '⤢'}</button
				>
			</div>
		</div>
	</div>

	<!-- Skip and up-next prompts stay clickable while the controls are hidden. -->
	<div
		class="absolute right-4 flex flex-col items-end gap-3 transition-[bottom] duration-200 md:right-8"
		style:bottom="calc({controlsVisible ? '7.5rem' : '2rem'} + env(safe-area-inset-bottom))"
	>
		{#if skipNotice}
			<div
				class="flex items-center gap-3 rounded-lg bg-black/80 py-2 pr-2 pl-4 text-sm"
				role="status"
				data-testid="skip-notice"
			>
				{skipNotice.marker.type === 'intro' ? 'Intro skipped' : 'Credits skipped'}
				<button class="btn btn-secondary min-h-9 px-3 py-1" onclick={undoSkip}>Go back</button>
			</div>
		{/if}
		{#if nextPrompt && nextUp}
			<div
				class="flex w-72 flex-col gap-3 rounded-lg bg-black/85 p-4 shadow-xl"
				role="dialog"
				aria-label="Up next"
				data-testid="up-next"
			>
				<p class="text-xs font-semibold tracking-wide text-white/60 uppercase">Up next</p>
				<p class="font-semibold">
					{#if nextUp.parentIndex !== undefined && nextUp.index !== undefined}
						S{nextUp.parentIndex} · E{nextUp.index} ·
					{/if}
					{nextUp.title}
				</p>
				<div class="flex gap-2">
					<button class="btn btn-primary flex-1" onclick={playNext}
						>{countdown !== null ? `Play next in ${countdown}` : 'Play next'}</button
					>
					{#if countdown !== null}
						<button class="btn btn-secondary" onclick={cancelCountdown}>Cancel</button>
					{:else}
						<button class="btn btn-secondary" onclick={closeNext}>Close</button>
					{/if}
				</div>
			</div>
		{:else if activeMarker && !skipNotice}
			<button
				class="btn min-h-11 border border-white/40 bg-black/70 px-5 font-semibold hover:bg-black/90"
				onclick={() => skipMarker(activeMarker)}
				data-testid="skip-marker"
				>{activeMarker.type === 'intro' ? 'Skip Intro' : 'Skip Credits'}</button
			>
		{/if}
	</div>

	{#if fileInfo && info && currentVersion && currentPart}
		<FileInfo
			version={currentVersion}
			part={currentPart}
			methodLabel={info.methodLabel}
			reason={info.reason}
			onclose={() => (fileInfo = false)}
		/>
	{/if}
</div>

<style>
	.ctl {
		display: inline-flex;
		min-width: 44px;
		min-height: 44px;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		font-weight: 600;
	}
	.ctl:hover {
		background: rgb(255 255 255 / 0.12);
	}
	.skip-flash {
		animation: flash 600ms ease-out forwards;
	}
	@keyframes flash {
		from {
			opacity: 1;
		}
		to {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.skip-flash {
			animation: none;
		}
	}
</style>
