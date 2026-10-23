<script lang="ts">
	import { itemHref, progress, subtitle, unwatchedCount } from '#lib/media.js';
	import type { MediaItem } from '#lib/plex-types.js';
	import Icon from './Icon.svelte';

	let {
		item,
		href: hrefOverride,
		landscape = item.type === 'episode' || item.type === 'clip',
		eager = false
	}: { item: MediaItem; href?: string; landscape?: boolean; eager?: boolean } = $props();

	const href = $derived(hrefOverride ?? itemHref(item));

	const image = $derived(
		landscape && item.type !== 'episode' && item.type !== 'clip' && item.art ? item.art : item.thumb
	);
	const fraction = $derived(progress(item));
	const unwatched = $derived(unwatchedCount(item));
	const sub = $derived(subtitle(item));
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- href comes from itemHref(), which uses resolve() -->
<a
	{href}
	class="group flex min-h-11 flex-col gap-2 rounded-lg outline-offset-4"
	data-testid="poster-card"
>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
	<div
		class="relative overflow-hidden rounded-lg bg-surface-2 ring-accent transition group-hover:ring-2 {landscape
			? 'aspect-video'
			: 'aspect-[2/3]'}"
	>
		{#if image}
			<img
				src={image}
				alt=""
				loading={eager ? 'eager' : 'lazy'}
				decoding="async"
				class="h-full w-full object-cover"
			/>
		{:else}
			<div class="flex h-full items-center justify-center p-2 text-center text-sm text-muted">
				{item.title}
			</div>
		{/if}
		{#if item.watched}
			<span
				class="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-on-accent"
				title="Watched"
				data-testid="watched-badge"
			>
				<Icon name="check" size={14} label="Watched" />
			</span>
		{:else if unwatched > 0}
			<span
				class="absolute top-1.5 right-1.5 min-w-6 rounded-full bg-accent px-1.5 text-center text-xs leading-6 font-bold text-on-accent"
				aria-label="{unwatched} unwatched episode{unwatched === 1 ? '' : 's'}"
				data-testid="unwatched-badge">{unwatched}</span
			>
		{/if}
		{#if fraction !== null}
			<div
				class="absolute inset-x-0 bottom-0 h-1 bg-black/60"
				role="progressbar"
				aria-label="Watched"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={Math.round(fraction * 100)}
			>
				<div class="h-full bg-accent" style:width="{fraction * 100}%"></div>
			</div>
		{/if}
	</div>
	<div class="min-w-0">
		<p class="truncate text-sm font-medium">{item.title}</p>
		{#if sub}
			<p class="truncate text-xs text-muted">{sub}</p>
		{/if}
	</div>
</a>
