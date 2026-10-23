<script lang="ts">
	import { onMount } from 'svelte';
	import { followSubtitle } from './subtitle-feed';

	let {
		url,
		video,
		streamOffset,
		onfail
	}: {
		url: string;
		/** The video element the subtitles are drawn over and timed by. */
		video: HTMLVideoElement;
		/** Item time (ms) at which the stream starts; cue times are item times. */
		streamOffset: number;
		/** JASSUB could not run here; the caller falls back to simple subtitles. */
		onfail: () => void;
	} = $props();

	let canvas: HTMLCanvasElement;

	onMount(() => {
		const controller = new AbortController();
		let instance: import('jassub').default | undefined;
		let pending: string | null = null;
		let loaded = '';
		let timer: ReturnType<typeof setTimeout> | undefined;

		// Hands the text read so far to libass, at most twice a second while it grows.
		const flush = async () => {
			timer = undefined;
			if (!instance || pending === null || pending === loaded) return;
			loaded = pending;
			await instance.ready;
			await instance.renderer.setTrack(loaded);
			// JASSUB draws on new video frames; repaint now so a paused video shows the new events.
			await instance.resize(true);
		};

		(async () => {
			// Loaded only now: the library, its worker and its WASM are only fetched for ASS/SSA.
			const [{ default: JASSUB }, { default: fallbackFont }] = await Promise.all([
				import('jassub'),
				import('jassub/dist/default.woff2?url')
			]);
			if (controller.signal.aborted) return;
			instance = new JASSUB({
				video,
				canvas,
				subContent: '[Script Info]\nScriptType: v4.00+\n',
				timeOffset: streamOffset / 1000,
				// No local-font permission prompt; libass uses the fonts embedded in the script and
				// JASSUB's bundled Liberation Sans for the rest. That one is loaded up front: fetched on
				// demand, it would arrive after the first frame and a paused video would stay blank.
				queryFonts: false,
				fonts: [fallbackFont]
			});
			await instance.ready;
			followSubtitle(url, controller.signal, (text) => {
				pending = text;
				timer ??= setTimeout(() => void flush().catch(fail), 500);
			});
		})().catch(fail);

		function fail() {
			if (!controller.signal.aborted) onfail();
		}

		return () => {
			controller.abort();
			clearTimeout(timer);
			void instance?.destroy().catch(() => {});
		};
	});
</script>

<canvas
	bind:this={canvas}
	class="pointer-events-none absolute"
	aria-hidden="true"
	data-testid="ass-subtitles"
></canvas>
