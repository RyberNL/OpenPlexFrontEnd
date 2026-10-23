<script lang="ts">
	import ItemCollection from '#lib/components/ItemCollection.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>{data.collection.title} · OpenPlexFrontEnd</title></svelte:head>

<ItemCollection
	container={data.collection}
	items={data.items}
	queue="collection:{data.collection.id}"
/>
