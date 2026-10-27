<script lang="ts">
	import changelog from '../../../../../CHANGELOG.md?raw';
	import { parseChangelog } from '#lib/changelog.js';
	import { APP_VERSION, BUILD_DATE } from '#lib/version.js';

	const releases = parseChangelog(changelog);
</script>

<svelte:head><title>About · OpenPlexFrontEnd</title></svelte:head>

<div class="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-6">
	<section class="flex flex-col gap-1">
		<h1 class="text-2xl font-bold">OpenPlexFrontEnd</h1>
		<p class="text-muted">
			Version <span class="font-semibold text-text" data-testid="app-version">{APP_VERSION}</span>,
			built {BUILD_DATE}
		</p>
	</section>

	<section class="flex flex-col gap-6" aria-labelledby="changelog">
		<h2 id="changelog" class="text-xl font-semibold">What's new</h2>
		{#each releases as release (release.version)}
			<article class="flex flex-col gap-3" data-testid="release">
				<h3 class="text-lg font-semibold">
					{release.version}
					{#if release.version === APP_VERSION}
						<span class="ml-2 rounded bg-accent px-2 py-0.5 text-xs font-bold text-on-accent"
							>Running</span
						>
					{/if}
					{#if release.date}<span class="ml-2 text-sm font-normal text-muted">{release.date}</span
						>{/if}
				</h3>
				{#each release.sections as section, i (i)}
					{#if section.title}<h4 class="text-sm font-semibold tracking-wide text-muted uppercase">
							{section.title}
						</h4>{/if}
					<ul class="flex list-disc flex-col gap-1.5 pl-5">
						{#each section.items as item, j (j)}<li>{item}</li>{/each}
					</ul>
				{/each}
			</article>
		{/each}
	</section>
</div>
