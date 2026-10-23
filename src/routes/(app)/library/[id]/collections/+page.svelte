<script lang="ts">
	import { resolve } from '$app/paths';
	import PosterCard from '#lib/components/PosterCard.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>Collections · {data.library.title} · OpenPlexFrontEnd</title></svelte:head>

<div class="px-4 py-6 md:px-8">
	<a href={resolve('/(app)/library/[id]', { id: data.library.id })} class="btn-link text-sm"
		>← {data.library.title}</a
	>
	<h1 class="text-2xl font-bold">Collections</h1>
	{#if data.collections.length}
		<ul
			class="mt-6 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4"
			aria-label="Collections"
		>
			{#each data.collections as item (item.id)}
				<li><PosterCard {item} /></li>
			{/each}
		</ul>
	{:else}
		<p class="mt-4 text-muted">This library has no collections.</p>
	{/if}
</div>
