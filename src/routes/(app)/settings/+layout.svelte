<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	let { children } = $props();
	const tabs = [
		{ href: resolve('/(app)/settings/account'), label: 'Account' },
		{ href: resolve('/(app)/settings/security'), label: 'Security' },
		{ href: resolve('/(app)/settings/playback'), label: 'Playback' },
		{ href: resolve('/(app)/settings/about'), label: 'About' }
	];
</script>

<nav aria-label="Settings" class="mx-auto max-w-2xl px-4 pt-6">
	<ul class="flex gap-1 border-b border-border sm:gap-2">
		{#each tabs as tab (tab.href)}
			<li>
				<a
					href={tab.href}
					aria-current={page.url.pathname === tab.href ? 'page' : undefined}
					class="-mb-px inline-flex min-h-11 items-center border-b-2 border-transparent px-2 text-muted aria-[current=page]:border-accent aria-[current=page]:text-text sm:px-3"
					>{tab.label}</a
				>
			</li>
		{/each}
	</ul>
</nav>
{@render children()}
