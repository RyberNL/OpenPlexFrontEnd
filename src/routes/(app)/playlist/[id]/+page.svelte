<script lang="ts">
	import ItemCollection from '#lib/components/ItemCollection.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>{data.playlist.title} · OpenPlexFrontEnd</title></svelte:head>

<ItemCollection
	container={data.playlist}
	items={data.items}
	queue="playlist:{data.playlist.id}"
	ordered
/>
