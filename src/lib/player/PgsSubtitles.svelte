<script lang="ts">
	import { onMount } from 'svelte';

	let {
		url,
		video,
		streamOffset,
		onfail
	}: {
		url: string;
		/** The video element the subtitles are drawn over and timed by. */
		video: HTMLVideoElement;
		/** Item time (ms) at which the stream starts; PGS times are item times. */
		streamOffset: number;
		/** libpgs could not show the file; the caller has the server burn it in instead. */
		onfail: () => void;
	} = $props();

	let canvas: HTMLCanvasElement;

	onMount(() => {
		let disposed = false;
		let renderer: import('libpgs').PgsRenderer | undefined;
		(async () => {
			// Loaded only now: libpgs and its worker are only fetched for PGS subtitles.
			const [{ PgsRenderer }, { default: workerUrl }] = await Promise.all([
				import('libpgs'),
				import('libpgs/dist/libpgs.worker.js?url')
			]);
			if (disposed) return;
			renderer = new PgsRenderer({
				video,
				canvas,
				workerUrl,
				timeOffset: streamOffset / 1000,
				aspectRatio: 'contain'
			});
			await renderer.loadFromUrl(url);
		})().catch(() => {
			if (!disposed) onfail();
		});
		return () => {
			disposed = true;
			renderer?.dispose();
		};
	});
</script>

<canvas
	bind:this={canvas}
	class="pointer-events-none absolute inset-0 h-full w-full object-contain"
	aria-hidden="true"
	data-testid="pgs-subtitles"
></canvas>
