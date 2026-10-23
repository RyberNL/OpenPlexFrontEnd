<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import type { MediaItem } from '#lib/plex-types.js';
	import { columnsFor, gridHeight, offsetOf, pagesToLoad, visibleRange } from '#lib/virtual.js';
	import PosterCard from './PosterCard.svelte';
	import Skeleton from './Skeleton.svelte';

	let {
		total,
		initial = [],
		pageSize = 60,
		load,
		landscape = false,
		label
	}: {
		/** Total number of items in the (filtered) library. */
		total: number;
		/** Items already loaded from offset 0, e.g. by the page load function. */
		initial?: MediaItem[];
		pageSize?: number;
		load: (offset: number, size: number) => Promise<MediaItem[]>;
		landscape?: boolean;
		label: string;
	} = $props();

	const GAP = 16;
	const TEXT_HEIGHT = 44;

	let container: HTMLDivElement | undefined = $state();
	let width = $state(0);
	let viewportTop = $state(0);
	let viewportHeight = $state(900);

	const items = new SvelteMap<number, MediaItem>();
	const loaded = new SvelteSet<number>();
	// Plain bookkeeping of requests in flight; deliberately not reactive.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const inflight = new Set<number>();

	// Seed with the server-rendered first page (and reseed when it changes, e.g. new sort).
	$effect.pre(() => {
		items.clear();
		loaded.clear();
		inflight.clear();
		initial.forEach((item, i) => items.set(i, item));
		if (initial.length) loaded.add(0);
	});

	const minCard = $derived(landscape ? 240 : width < 640 ? 108 : 150);
	const metrics = $derived.by(() => {
		const columns = columnsFor(width || 360, minCard, GAP);
		const cardWidth = ((width || 360) - (columns - 1) * GAP) / columns;
		const imageHeight = landscape ? (cardWidth * 9) / 16 : cardWidth * 1.5;
		return { columns, rowHeight: Math.ceil(imageHeight + TEXT_HEIGHT), gap: GAP };
	});
	const range = $derived(visibleRange(total, metrics, viewportTop, viewportHeight));
	const height = $derived(gridHeight(total, metrics));
	const indices = $derived(
		Array.from({ length: range.end - range.start }, (_, i) => range.start + i)
	);

	async function loadPage(offset: number) {
		if (inflight.has(offset) || loaded.has(offset)) return;
		inflight.add(offset);
		try {
			const page = await load(offset, pageSize);
			page.forEach((item, i) => items.set(offset + i, item));
			loaded.add(offset);
		} finally {
			inflight.delete(offset);
		}
	}

	$effect(() => {
		for (const offset of pagesToLoad(range.start, range.end, pageSize, loaded)) {
			void loadPage(offset);
		}
	});

	function measure() {
		if (!container) return;
		const rect = container.getBoundingClientRect();
		viewportTop = Math.max(0, -rect.top);
		viewportHeight = window.innerHeight;
	}

	onMount(() => {
		const observer = new ResizeObserver(([entry]) => {
			width = entry.contentRect.width;
			measure();
		});
		observer.observe(container!);
		measure();
		window.addEventListener('scroll', measure, { passive: true });
		window.addEventListener('resize', measure);
		return () => {
			observer.disconnect();
			window.removeEventListener('scroll', measure);
			window.removeEventListener('resize', measure);
		};
	});

	/** Scrolls the page so that the item at `index` is at the top of the viewport. */
	export function scrollToIndex(index: number) {
		if (!container) return;
		const top = container.getBoundingClientRect().top + window.scrollY + offsetOf(index, metrics);
		window.scrollTo({ top: Math.max(0, top - 72), behavior: 'auto' });
		measure();
	}
</script>

<div bind:this={container} class="relative" style:height="{height}px" data-testid="virtual-grid">
	<ul
		class="absolute inset-x-0 grid"
		style:top="{offsetOf(range.start, metrics)}px"
		style:grid-template-columns="repeat({metrics.columns}, minmax(0, 1fr))"
		style:gap="{GAP}px"
		aria-label={label}
	>
		{#each indices as index (index)}
			{@const item = items.get(index)}
			<li style:height="{metrics.rowHeight}px" data-index={index}>
				{#if item}
					<PosterCard {item} {landscape} />
				{:else}
					<Skeleton class={landscape ? 'aspect-video w-full' : 'aspect-[2/3] w-full'} />
				{/if}
			</li>
		{/each}
	</ul>
</div>
