<script lang="ts">
	import PosterCard from '#lib/components/PosterCard.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const movies = $derived(data.items.filter((i) => i.type === 'movie'));
	const shows = $derived(data.items.filter((i) => i.type !== 'movie'));
</script>

<svelte:head><title>{data.name} · OpenPlexFrontEnd</title></svelte:head>

<div class="px-4 py-6 md:px-8">
	<h1 class="text-2xl font-bold">{data.name}</h1>
	<p class="text-muted">In your libraries</p>
	{#each [{ title: 'Movies', list: movies }, { title: 'Shows', list: shows }] as group (group.title)}
		{#if group.list.length}
			<section class="mt-6" aria-label={group.title}>
				<h2 class="text-lg font-semibold">{group.title}</h2>
				<ul
					class="mt-3 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4"
					aria-label={group.title}
				>
					{#each group.list as item (item.id)}
						<li><PosterCard {item} /></li>
					{/each}
				</ul>
			</section>
		{/if}
	{/each}
	{#if data.items.length === 0}
		<p class="mt-6 text-muted">Nothing in your libraries features this person.</p>
	{/if}
</div>
