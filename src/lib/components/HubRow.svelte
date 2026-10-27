<script lang="ts">
	import type { MediaItem } from '#lib/plex-types.js';
	import Icon from './Icon.svelte';
	import PosterCard from './PosterCard.svelte';

	let {
		title,
		items,
		moreHref,
		landscape,
		hrefFor
	}: {
		title: string;
		items: MediaItem[];
		moreHref?: string;
		landscape?: boolean;
		/** Overrides where each card links (e.g. straight into resume playback). */
		hrefFor?: (item: MediaItem) => string;
	} = $props();

	let scroller: HTMLUListElement | undefined = $state();
	const id = $props.id();

	function scrollBy(direction: 1 | -1) {
		if (!scroller) return;
		scroller.scrollBy({ left: direction * scroller.clientWidth * 0.8, behavior: 'smooth' });
	}
</script>

<section aria-labelledby="{id}-title" class="flex flex-col gap-3">
	<div class="flex items-center justify-between gap-3 px-4 md:px-8">
		<h2 id="{id}-title" class="text-lg font-semibold">{title}</h2>
		<div class="flex items-center gap-1">
			{#if moreHref}
				<!-- eslint-disable svelte/no-navigation-without-resolve -- callers pass resolved hrefs -->
				<a href={moreHref} class="btn-link inline-flex items-center px-2 text-sm">See all</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/if}
			<button
				type="button"
				class="hidden h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-text md:flex"
				aria-label="Scroll {title} back"
				onclick={() => scrollBy(-1)}
			>
				<Icon name="back" />
			</button>
			<button
				type="button"
				class="hidden h-11 w-11 rotate-180 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-text md:flex"
				aria-label="Scroll {title} forward"
				onclick={() => scrollBy(1)}
			>
				<Icon name="back" />
			</button>
		</div>
	</div>
	<ul
		bind:this={scroller}
		class="row flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-4 pb-2 md:gap-4 md:px-8"
		aria-label={title}
	>
		{#each items as item (item.id)}
			<li class="shrink-0 snap-start {landscape ? 'w-60 sm:w-72' : 'w-32 sm:w-36 lg:w-40'}">
				<!-- Every card in a row has one shape, also in rows mixing shows and episodes. -->
				<PosterCard {item} landscape={!!landscape} href={hrefFor?.(item)} />
			</li>
		{/each}
	</ul>
</section>

<style>
	.row {
		scrollbar-width: none;
		scroll-padding-inline: 1rem;
	}
	.row::-webkit-scrollbar {
		display: none;
	}
</style>
