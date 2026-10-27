<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { probeCapabilities } from '#lib/capabilities.js';
	import Icon from '#lib/components/Icon.svelte';
	import type { Quality } from '#lib/playback.js';
	import type { Airing, LiveChannel } from '#lib/plex-types.js';
	import { deviceId } from './device';
	import { cast } from './cast.svelte';
	import { attachStream, prefersNativeHls } from './engine';
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

	type LiveInfo = {
		playbackId: string;
		src: string;
		kind: 'hls';
		streamOffset: 0;
		startAt: 0;
		channel: LiveChannel;
		airing: Airing | null;
	};

	let {
		channel,
		channels,
		airings,
		quality,
		onBack,
		onSwitch
	}: {
		/** The channel to tune. */
		channel: string;
		channels: LiveChannel[];
		/** Guide airings around now, for the current program of each channel. */
		airings: Airing[];
		quality: Quality;
		onBack: () => void;
		/** Navigate to another channel (called after this one's tuner is released). */
		onSwitch: (channelId: string) => void;
	} = $props();

	let video: HTMLVideoElement | undefined = $state();
	let info = $state<LiveInfo | null>(null);
	let error = $state<{ message: string; busy: boolean } | null>(null);
	let loading = $state(true);
	let playing = $state(false);
	let muted = $state(false);
	let controlsVisible = $state(true);
	let picker = $state(false);
	let now = $state(Date.now());
	/** Seconds behind live (pausing, stalls or seeking back). */
	let behind = $state(0);
	/**
	 * Where live was when playback first ran: the video time and the clock time. Live then moves
	 * on with the clock, wherever hls.js chose to start within the stream.
	 */
	let anchor: { media: number; wall: number } | null = null;
	const liveTime = () => (anchor ? anchor.media + (Date.now() - anchor.wall) / 1000 : 0);
	/** The buffer the user can seek in, in seconds of the stream. */
	let buffer = $state({ start: 0, end: 0, time: 0 });

	let detach: (() => void) | undefined;
	let released = false;
	let releasing: Promise<void> | undefined;
	let reportTimer: ReturnType<typeof setInterval> | undefined;
	let clockTimer: ReturnType<typeof setInterval> | undefined;
	let bufferTimer: ReturnType<typeof setInterval> | undefined;
	let hideTimer: ReturnType<typeof setTimeout> | undefined;
	/** Set while switching channels: casting carries on with the next channel. */
	let switching = false;

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
	/** The channel plays on a Chromecast; the local video is detached meanwhile. */
	let castingHere = $state(false);

	const current = $derived(channels.find((c) => c.id === channel));
	const index = $derived(channels.findIndex((c) => c.id === channel));
	const onNowFor = (id: string) =>
		airings.find((a) => a.channelId === id && a.beginsAt <= now && now < a.endsAt);
	const airing = $derived(onNowFor(channel) ?? info?.airing ?? null);

	const time = (ms: number) =>
		new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	function clock(seconds: number) {
		const s = Math.max(0, Math.round(seconds));
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	}

	async function tune() {
		loading = true;
		error = null;
		// After a stream error, the old playback must be gone before its tuner can be had again.
		await releasing;
		const response = await fetch('/api/live/tune', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ channel, quality, caps: probeCapabilities(), deviceId: deviceId() })
		}).catch(() => null);
		if (!response?.ok) {
			const body = await response?.json().catch(() => null);
			error = {
				message: body?.message ?? 'The channel could not be tuned.',
				busy: body?.code === 'tuner_busy'
			};
			loading = false;
			return;
		}
		info = await response.json();
		released = false;
		clearInterval(reportTimer);
		reportTimer = setInterval(() => report(video?.paused ? 'paused' : 'playing'), 10_000);
		// Still casting from the previous channel: this one goes to the TV too.
		if (cast.device !== null) {
			await castChannel();
			return;
		}
		if (prefersNativeHls()) {
			// AirPlay hands the URL to the TV, which fetches the stream without the session cookie.
			const source = await castSource(info!.playbackId);
			if (source) info!.src = source.src;
		}
		await playHere();
	}

	async function playHere() {
		await tick();
		detach = await attachStream(video!, info!, (message) => {
			error = { message, busy: false };
			// A dead stream must not keep reporting (which keeps the tuner) or hold the tuner.
			releasing = release();
		});
		await video!.play().catch(() => {
			// Autoplay may be blocked; the play button remains available.
		});
		loading = false;
	}

	/** Picks a Chromecast and moves the channel there; the tuner stays with this playback. */
	async function startCasting() {
		if (!(await cast.connect())) return;
		await castChannel();
	}

	async function castChannel() {
		if (!info) return;
		loading = true;
		detach?.();
		detach = undefined;
		const source = await castSource(info.playbackId);
		try {
			if (!source) throw new Error('No cast URL');
			await cast.load({
				...source,
				live: true,
				title: current?.title ?? 'Live TV',
				subtitle: airing?.title
			});
			castingHere = true;
		} catch {
			cast.disconnect();
			await playHere();
			error = { message: 'The channel could not be played on the Chromecast.', busy: false };
			return;
		}
		loading = false;
	}

	$effect(() => {
		// The cast session ended (here, from Chrome's menu, or on the TV): watch here again.
		if (castingHere && cast.device === null) {
			castingHere = false;
			loading = true;
			void playHere();
		}
	});

	$effect(() => {
		if (!video) return;
		allowAutoPip(video);
		return watchAirPlay(video, (state) => (airplay = state));
	});

	// Lock screen and notification controls, so the channel can play on in the background.
	$effect(() => {
		if (!current) return;
		setMediaControls({
			title: airing?.title ?? current.title,
			artist: `${current.number} ${current.title}`,
			play: () => (castingHere ? cast.paused && cast.playOrPause() : void video?.play()),
			pause: () => (castingHere ? !cast.paused && cast.playOrPause() : video?.pause())
		});
	});

	/** Keeps the playback alive on the server (and visible in the Plex dashboard). */
	function report(state: 'playing' | 'paused' | 'stopped', keepalive = false) {
		if (!info || released) return;
		void fetch(`/api/playback/${info.playbackId}/timeline`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ state, time: Math.round((video?.currentTime ?? 0) * 1000) }),
			keepalive
		}).catch(() => {});
	}

	/** Ends the playback: stops the stream and frees the tuner (awaited before tuning another). */
	async function release() {
		clearInterval(reportTimer);
		detach?.();
		detach = undefined;
		if (!info || released) return;
		released = true;
		await fetch(`/api/playback/${info.playbackId}`, { method: 'DELETE' }).catch(() => {});
	}

	/**
	 * The page is going away (tab closed, reload, full navigation): a final "stopped" report that
	 * outlives the page. The server then ends the playback, which frees the tuner.
	 */
	function releaseOnUnload() {
		// The TV plays on; the server ends the playback (and frees the tuner) once it stops.
		if (!info || released || castingHere) return;
		report('stopped', true);
		released = true;
	}

	async function switchTo(id: string) {
		picker = false;
		if (id === channel) return;
		loading = true;
		switching = true;
		await release();
		onSwitch(id);
	}

	function step(direction: 1 | -1) {
		if (!channels.length) return;
		const next = channels[(index + direction + channels.length) % channels.length];
		void switchTo(next.id);
	}

	function updateBuffer() {
		if (!video) return;
		const seekable = video.seekable;
		const start = seekable.length ? seekable.start(0) : 0;
		const end = seekable.length ? seekable.end(seekable.length - 1) : video.currentTime;
		buffer = { start, end, time: video.currentTime };
		behind = anchor ? Math.max(0, Math.min(liveTime(), end) - video.currentTime) : 0;
	}

	function seek(seconds: number) {
		if (!video) return;
		video.currentTime = Math.max(buffer.start, Math.min(buffer.end, seconds));
		updateBuffer();
		reveal();
	}

	function goLive() {
		seek(Math.min(liveTime(), buffer.end));
		void video?.play();
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

	function reveal() {
		controlsVisible = true;
		clearTimeout(hideTimer);
		hideTimer = setTimeout(() => {
			if (playing && !picker) controlsVisible = false;
		}, 3500);
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
			case 'ArrowLeft':
				return handled(() => seek(buffer.time - 10));
			case 'ArrowRight':
				return handled(() => seek(buffer.time + 10));
			case 'PageUp':
				return handled(() => step(1));
			case 'PageDown':
				return handled(() => step(-1));
			case 'm':
				return handled(() => video && (video.muted = !video.muted));
			case 'Escape':
				if (picker) return handled(() => (picker = false));
				return;
		}
	}

	onMount(() => {
		void cast.init();
		void tune();
		clockTimer = setInterval(() => (now = Date.now()), 30_000);
		// The live edge moves on while paused, when the video fires no time updates.
		bufferTimer = setInterval(updateBuffer, 1000);
		reveal();
	});

	onDestroy(() => {
		clearInterval(clockTimer);
		clearInterval(bufferTimer);
		clearTimeout(hideTimer);
		if (castingHere && !switching) cast.disconnect();
		clearMediaControls();
		void release();
	});
</script>

<svelte:window onkeydown={onKeydown} onpagehide={releaseOnUnload} />

<div
	class="fixed inset-0 bg-black text-white select-none"
	role="application"
	aria-label="Live TV player"
	data-testid="live-player"
	onpointermove={reveal}
>
	<video
		bind:this={video}
		class="h-full w-full object-contain"
		class:invisible={castingHere}
		playsinline
		bind:muted
		onplay={() => ((playing = true), report('playing'))}
		onpause={() => ((playing = false), report('paused'))}
		onplaying={() => (anchor ??= { media: video!.currentTime, wall: Date.now() })}
		ontimeupdate={updateBuffer}
		onprogress={updateBuffer}
		onclick={togglePlay}
		data-testid="video"
	></video>

	{#if (castingHere || airplay.active) && !loading}
		<div
			class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center"
			data-testid="casting"
		>
			<Icon name={castingHere ? 'cast' : 'airplay'} size={48} class="text-white/70" />
			<p class="text-lg font-semibold">Playing on {castingHere ? cast.device : 'AirPlay'}</p>
		</div>
	{/if}

	{#if loading && !error}
		<div
			class="pointer-events-none absolute inset-0 flex items-center justify-center"
			role="status"
		>
			<span class="h-12 w-12 animate-spin rounded-full border-4 border-white/30 border-t-white"
			></span>
			<span class="sr-only">Tuning</span>
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
		<div class="absolute inset-0 flex items-center justify-center bg-black/85 p-6" role="alert">
			<div class="flex max-w-md flex-col items-center gap-4 text-center">
				<p class="text-lg font-semibold" data-testid="live-error">{error.message}</p>
				{#if error.busy}
					<p class="text-sm text-white/70">
						The tuner is in use, for example by another device watching Live TV.
					</p>
				{/if}
				<div class="flex gap-3">
					<button class="btn btn-primary" onclick={() => void tune()}>Try again</button>
					<button class="btn btn-secondary" onclick={onBack}>Back</button>
				</div>
			</div>
		</div>
	{/if}

	<div
		class="pointer-events-none absolute inset-0 flex flex-col justify-between transition-opacity duration-200"
		class:opacity-0={!controlsVisible}
		data-testid="controls"
	>
		<div
			class="player-bar-top pointer-events-auto flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent"
		>
			<button class="ctl" aria-label="Back" onclick={onBack}><Icon name="back" /></button>
			<div class="min-w-0 flex-1">
				<p class="truncate text-lg font-semibold" data-testid="live-channel">
					<span class="text-white/60 tabular-nums">{current?.number}</span>
					{current?.title}
				</p>
				{#if airing}
					<p class="truncate text-sm text-white/80" data-testid="live-program">
						{airing.title}{airing.subtitle ? ` · ${airing.subtitle}` : ''}
						<span class="text-white/60"> · {time(airing.beginsAt)}–{time(airing.endsAt)}</span>
					</p>
				{/if}
			</div>
		</div>

		{#if info && !error}
			<div
				class="player-bar-bottom pointer-events-auto flex flex-col gap-2 bg-gradient-to-t from-black/90 to-transparent"
			>
				<div class="flex items-center gap-3 text-sm tabular-nums">
					<input
						type="range"
						class="h-11 flex-1 cursor-pointer accent-[var(--color-accent)]"
						aria-label="Seek within the live buffer"
						aria-valuetext={behind < 2 ? 'Live' : `${clock(behind)} behind live`}
						min={buffer.start}
						max={Math.max(buffer.end, buffer.start + 1)}
						step="1"
						value={buffer.time}
						oninput={(e) => seek(Number(e.currentTarget.value))}
					/>
					{#if behind >= 2}
						<span data-testid="behind">−{clock(behind)}</span>
						<button class="rounded bg-white/15 px-2 py-1 text-xs font-bold" onclick={goLive}
							>Go live</button
						>
					{:else}
						<span
							class="rounded bg-red-600 px-2 py-1 text-xs font-bold tracking-wide"
							data-testid="live-badge">LIVE</span
						>
					{/if}
				</div>
				<div class="flex items-center gap-1">
					<button class="ctl" aria-label="Previous channel" onclick={() => step(-1)}>▲</button>
					<button class="ctl" aria-label={playing ? 'Pause' : 'Play'} onclick={togglePlay}>
						{#if playing}
							<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"
								><path fill="currentColor" d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg
							>
						{:else}
							<Icon name="play" />
						{/if}
					</button>
					<button class="ctl" aria-label="Next channel" onclick={() => step(1)}>▼</button>
					<button
						class="ctl px-2"
						aria-label={muted ? 'Unmute' : 'Mute'}
						onclick={() => (muted = !muted)}>{muted ? '🔇' : '🔊'}</button
					>
					<span class="flex-1"></span>
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
							onclick={() => (castingHere ? cast.disconnect() : void startCasting())}
							data-testid="cast"><Icon name="cast" /></button
						>
					{/if}
					{#if pipSupported && !castingHere}
						<button class="ctl" aria-label="Picture in picture" onclick={pip}
							><Icon name="pip" /></button
						>
					{/if}
					<button
						class="ctl px-3 text-sm"
						aria-label="Channels"
						aria-expanded={picker}
						onclick={() => ((picker = !picker), reveal())}>Channels</button
					>
				</div>
			</div>
		{:else}
			<div></div>
		{/if}
	</div>

	{#if picker}
		<div
			class="absolute inset-y-0 right-0 z-10 flex w-full max-w-sm flex-col bg-black/90 shadow-2xl"
			role="dialog"
			aria-label="Channels"
		>
			<div class="flex items-center justify-between p-4">
				<h2 class="text-lg font-semibold">Channels</h2>
				<button class="btn btn-secondary min-h-9 px-3 py-1" onclick={() => (picker = false)}
					>Close</button
				>
			</div>
			<ul class="flex-1 overflow-y-auto px-2 pb-4">
				{#each channels as c (c.id)}
					{@const program = onNowFor(c.id)}
					<li>
						<button
							class="flex min-h-14 w-full items-center gap-3 rounded px-2 py-2 text-left hover:bg-white/10"
							class:text-accent={c.id === channel}
							aria-current={c.id === channel ? 'true' : undefined}
							onclick={() => void switchTo(c.id)}
						>
							<span class="w-12 shrink-0 text-sm text-white/60 tabular-nums">{c.number}</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate font-semibold">{c.title}</span>
								{#if program}<span class="block truncate text-sm text-white/70"
										>{program.title}</span
									>{/if}
							</span>
						</button>
					</li>
				{/each}
			</ul>
		</div>
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
</style>
