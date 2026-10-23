<script lang="ts">
	import type { Snippet } from 'svelte';

	let { title, subtitle, children }: { title: string; subtitle?: string; children: Snippet } =
		$props();
</script>

<svelte:head>
	<title>{title} · OpenPlexFrontEnd</title>
</svelte:head>

<main class="flex min-h-dvh items-start justify-center px-4 py-10 sm:items-center">
	<div class="w-full max-w-md">
		<p class="mb-6 text-center text-lg font-bold tracking-wide text-accent">OpenPlexFrontEnd</p>
		<section class="card p-6 sm:p-8">
			<h1 class="text-2xl font-bold">{title}</h1>
			{#if subtitle}
				<p class="mt-1 text-muted">{subtitle}</p>
			{/if}
			<div class="mt-6">
				{@render children()}
			</div>
		</section>
	</div>
</main>
