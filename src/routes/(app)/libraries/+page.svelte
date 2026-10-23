<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Icon from '#lib/components/Icon.svelte';
</script>

<svelte:head>
	<title>Libraries · OpenPlexFrontEnd</title>
</svelte:head>

<div class="mx-auto max-w-2xl px-4 py-6">
	<h1 class="text-2xl font-bold">Libraries</h1>
	{#if page.data.libraries.length === 0}
		<p class="mt-4 text-muted">No libraries available.</p>
	{:else}
		<ul class="card mt-4 divide-y divide-border" aria-label="Libraries">
			{#each page.data.libraries as library (library.id)}
				<li>
					<a
						href={resolve('/(app)/library/[id]', { id: library.id })}
						class="flex min-h-14 items-center gap-3 px-4 hover:bg-surface-2"
					>
						<Icon name={library.type === 'movie' ? 'movie' : 'show'} />
						<span class="font-medium">{library.title}</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
	<a
		href={resolve('/(app)/playlists')}
		class="card mt-4 flex min-h-14 items-center gap-3 px-4 hover:bg-surface-2"
	>
		<Icon name="libraries" />
		<span class="font-medium">Playlists</span>
	</a>
</div>
