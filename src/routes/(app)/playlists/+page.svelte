<script lang="ts">
	import PosterCard from '#lib/components/PosterCard.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>Playlists · OpenPlexFrontEnd</title></svelte:head>

<div class="px-4 py-6 md:px-8">
	<h1 class="text-2xl font-bold">Playlists</h1>
	{#if data.playlists.length}
		<ul
			class="mt-6 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4"
			aria-label="Playlists"
		>
			{#each data.playlists as item (item.id)}
				<li><PosterCard {item} /></li>
			{/each}
		</ul>
	{:else}
		<p class="mt-4 text-muted">You have no video playlists yet. Create them in any Plex app.</p>
	{/if}
</div>
