<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	let retrying = $state(false);

	async function retry() {
		retrying = true;
		try {
			await refreshAll();
		} finally {
			retrying = false;
		}
	}

	const code = $derived(page.error?.code);
	/** The signed-in admin, who can link their own account instead of asking someone. */
	const admin = $derived(
		(page.data as { me?: { id: string; isAdmin: boolean } }).me?.isAdmin
			? (page.data as { me: { id: string } }).me
			: null
	);
	const title = $derived(
		code === 'plex_unavailable'
			? 'Media server unavailable'
			: code === 'plex_not_linked' || code === 'server_not_linked'
				? 'Not linked to Plex yet'
				: page.status === 404
					? 'Page not found'
					: page.status === 403
						? 'Not allowed'
						: 'Something went wrong'
	);
</script>

<svelte:head>
	<title>{title} · OpenPlexFrontEnd</title>
</svelte:head>

<div class="flex min-h-[60dvh] items-center justify-center px-4 py-10">
	<section class="card w-full max-w-md p-6 text-center" role="alert" aria-labelledby="error-title">
		<h1 id="error-title" class="text-xl font-bold">{title}</h1>
		<p class="mt-2 text-muted">
			{code === 'plex_not_linked' && admin
				? 'Your account is not linked to a Plex user yet. Choose your Plex user on your account page under Admin → Users.'
				: page.error?.message}
		</p>
		<div class="mt-6 flex flex-wrap justify-center gap-3">
			{#if code === 'plex_unavailable'}
				<button class="btn btn-primary" onclick={retry} disabled={retrying}>
					{retrying ? 'Retrying…' : 'Retry'}
				</button>
			{:else if code === 'plex_not_linked' && admin}
				<a class="btn btn-primary" href={resolve('/(app)/admin/users/[id]', { id: admin.id })}
					>Link your account</a
				>
			{:else if code === 'server_not_linked'}
				<a class="btn btn-primary" href={resolve('/(app)/admin/plex')}>Link a Plex server</a>
			{:else}
				<a class="btn btn-secondary" href={resolve('/(app)')}>Go home</a>
			{/if}
		</div>
	</section>
</div>
