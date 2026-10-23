<script lang="ts">
	import MediaDetails from '#lib/components/MediaDetails.svelte';
	import SeasonDetails from '#lib/components/SeasonDetails.svelte';
	import ShowDetails from '#lib/components/ShowDetails.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.item.title} · OpenPlexFrontEnd</title>
</svelte:head>

{#key data.item.id}
	{#if data.item.type === 'show'}
		<ShowDetails show={data.item} seasons={data.seasons} next={data.next} />
	{:else if data.item.type === 'season'}
		<SeasonDetails season={data.item} episodes={data.episodes} />
	{:else}
		<MediaDetails item={data.item} />
	{/if}
{/key}
