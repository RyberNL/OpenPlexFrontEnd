<script lang="ts">
	import FeaturedHero from '#lib/components/FeaturedHero.svelte';
	import HubRow from '#lib/components/HubRow.svelte';
	import SearchBar from '#lib/components/SearchBar.svelte';
	import { watchHref } from '#lib/media.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const d = $derived(data.discover);
	const empty = $derived(
		!d.continueWatching && !d.nextUp && d.recentlyAdded.length === 0 && d.recommended.length === 0
	);
</script>

<svelte:head>
	<title>Home · OpenPlexFrontEnd</title>
</svelte:head>

<h1 class="sr-only">Home</h1>
<SearchBar />
{#if d.featured}
	<FeaturedHero item={d.featured} />
{/if}
<div class="flex flex-col gap-8 py-6">
	{#if d.continueWatching}
		<HubRow
			title="Continue Watching"
			items={d.continueWatching.items}
			landscape
			hrefFor={(item) => watchHref(item, { from: 'resume' })}
		/>
	{/if}
	{#if d.nextUp}
		<HubRow title="Next Up" items={d.nextUp.items} landscape />
	{/if}
	{#each d.recentlyAdded as hub (hub.id)}
		<HubRow title={hub.title} items={hub.items} />
	{/each}
	{#each d.recommended as hub (hub.id)}
		<HubRow title={hub.title} items={hub.items} />
	{/each}
	{#if empty}
		<p class="px-4 text-muted md:px-8">Nothing to show yet. Add some movies or shows in Plex.</p>
	{/if}
</div>
