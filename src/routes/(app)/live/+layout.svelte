<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const sections = [
		{ href: resolve('/(app)/live'), label: 'Channels' },
		{ href: resolve('/(app)/live/guide'), label: 'Guide' },
		{ href: resolve('/(app)/live/whats-on'), label: "What's On" }
	];
</script>

{#if data.dvr}
	<div class="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 pt-6 md:px-8">
		<h1 class="text-3xl font-bold">Live TV</h1>
		<nav aria-label="Live TV sections">
			<ul class="flex gap-1">
				{#each sections as section (section.href)}
					<li>
						<!-- eslint-disable svelte/no-navigation-without-resolve -- hrefs built with resolve() -->
						<a
							href={section.href}
							aria-current={page.url.pathname === section.href ? 'page' : undefined}
							class="block rounded-full px-4 py-2 text-sm font-semibold text-muted hover:text-text aria-[current=page]:bg-surface-2 aria-[current=page]:text-text"
							>{section.label}</a
						>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					</li>
				{/each}
			</ul>
		</nav>
	</div>
	{@render children()}
{:else}
	<div
		class="flex flex-col items-center gap-2 px-4 py-16 text-center"
		data-testid="live-unavailable"
	>
		<h1 class="text-2xl font-bold">Live TV</h1>
		<p class="text-muted">Live TV is not set up on this server.</p>
	</div>
{/if}
