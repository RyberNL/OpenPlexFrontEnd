<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Icon from '#lib/components/Icon.svelte';
	import type { IconName } from '#lib/icons.js';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	type NavItem = { href: string; label: string; icon: IconName };

	const sidebar = $derived<NavItem[]>([
		{ href: resolve('/(app)'), label: 'Home', icon: 'home' },
		{ href: resolve('/(app)/search'), label: 'Search', icon: 'search' },
		{ href: resolve('/(app)/playlists'), label: 'Playlists', icon: 'libraries' },
		...(data.liveTv
			? [{ href: resolve('/(app)/live'), label: 'Live TV', icon: 'live' as IconName }]
			: []),
		...data.libraries.map((l) => ({
			href: resolve('/(app)/library/[id]', { id: l.id }),
			label: l.title,
			icon: (l.type === 'movie' ? 'movie' : 'show') as IconName
		}))
	]);

	const tabs = $derived<NavItem[]>([
		{ href: resolve('/(app)'), label: 'Home', icon: 'home' },
		{ href: resolve('/(app)/search'), label: 'Search', icon: 'search' },
		{ href: resolve('/(app)/libraries'), label: 'Libraries', icon: 'libraries' },
		...(data.liveTv
			? [{ href: resolve('/(app)/live'), label: 'Live TV', icon: 'live' as IconName }]
			: []),
		{ href: resolve('/(app)/settings/account'), label: 'Account', icon: 'user' }
	]);

	function active(href: string) {
		const path = page.url.pathname;
		if (href === '/') return path === '/';
		if (href === '/libraries') return path === '/libraries' || path.startsWith('/library/');
		if (href === '/settings/account')
			return path.startsWith('/settings') || path.startsWith('/admin');
		return path === href || path.startsWith(href + '/');
	}
</script>

<a
	href="#main"
	class="sr-only z-50 rounded bg-accent px-4 py-2 font-semibold text-on-accent focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
	>Skip to content</a
>

<!-- Sidebar: tablets and larger -->
<nav
	aria-label="Main"
	class="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-surface md:flex"
>
	<a href={resolve('/(app)')} class="px-6 pt-6 pb-4 text-lg font-bold tracking-wide text-accent"
		>OpenPlexFrontEnd</a
	>
	<ul class="flex flex-1 flex-col gap-1 overflow-y-auto px-3">
		{#each sidebar as item (item.href)}
			<li>
				<!-- eslint-disable svelte/no-navigation-without-resolve -- hrefs built with resolve() above -->
				<a
					href={item.href}
					aria-current={active(item.href) ? 'page' : undefined}
					class="flex min-h-11 items-center gap-3 rounded-lg px-3 text-muted hover:bg-surface-2 hover:text-text aria-[current=page]:bg-surface-2 aria-[current=page]:text-text"
				>
					<Icon name={item.icon} size={20} />
					<span class="truncate">{item.label}</span>
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</li>
		{/each}
	</ul>
	<div class="flex flex-col gap-1 border-t border-border p-3">
		<a
			href={resolve('/(app)/settings/account')}
			aria-current={page.url.pathname.startsWith('/settings') ? 'page' : undefined}
			class="flex min-h-11 items-center gap-3 rounded-lg px-3 text-muted hover:bg-surface-2 hover:text-text aria-[current=page]:bg-surface-2 aria-[current=page]:text-text"
		>
			<Icon name="user" size={20} />
			<span class="truncate">{data.me.displayName}</span>
		</a>
		{#if data.me.isAdmin}
			<a
				href={resolve('/(app)/admin/users')}
				aria-current={page.url.pathname.startsWith('/admin') ? 'page' : undefined}
				class="flex min-h-11 items-center gap-3 rounded-lg px-3 text-muted hover:bg-surface-2 hover:text-text aria-[current=page]:bg-surface-2 aria-[current=page]:text-text"
			>
				<Icon name="shield" size={20} />
				<span>Admin</span>
			</a>
		{/if}
	</div>
</nav>

<div class="min-h-dvh pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0 md:pl-60">
	<main id="main" tabindex="-1" class="outline-none">
		{@render children()}
	</main>
</div>

<!-- Bottom tab bar: phones -->
<nav
	aria-label="Tabs"
	class="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
>
	<ul class="grid auto-cols-fr grid-flow-col">
		{#each tabs as tab (tab.href)}
			<li>
				<!-- eslint-disable svelte/no-navigation-without-resolve -- hrefs built with resolve() above -->
				<a
					href={tab.href}
					aria-current={active(tab.href) ? 'page' : undefined}
					class="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs text-muted aria-[current=page]:text-accent"
				>
					<Icon name={tab.icon} size={22} />
					{tab.label}
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</li>
		{/each}
	</ul>
</nav>
