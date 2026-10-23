<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Person } from '#lib/plex-types.js';

	let { title, people }: { title: string; people: Person[] } = $props();
	const id = $props.id();
</script>

<section aria-labelledby="{id}-title" class="flex flex-col gap-3">
	<h2 id="{id}-title" class="px-4 text-lg font-semibold md:px-8">{title}</h2>
	<ul class="flex gap-4 overflow-x-auto px-4 pb-2 md:px-8" aria-label={title}>
		{#each people as person, i (person.id ?? `${person.name}-${i}`)}
			<li class="w-24 shrink-0 text-center">
				{#if person.id}
					<a
						href="{resolve('/(app)/person/[id]', { id: person.id })}?name={encodeURIComponent(
							person.name
						)}"
						class="flex flex-col items-center gap-2 rounded-lg"
					>
						{@render face(person)}
					</a>
				{:else}
					<div class="flex flex-col items-center gap-2">{@render face(person)}</div>
				{/if}
			</li>
		{/each}
	</ul>
</section>

{#snippet face(person: Person)}
	<div class="h-20 w-20 overflow-hidden rounded-full bg-surface-2">
		{#if person.thumb}
			<img src={person.thumb} alt="" loading="lazy" class="h-full w-full object-cover" />
		{/if}
	</div>
	<span class="line-clamp-2 text-sm font-medium">{person.name}</span>
	{#if person.role}
		<span class="line-clamp-2 text-xs text-muted">{person.role}</span>
	{/if}
{/snippet}
