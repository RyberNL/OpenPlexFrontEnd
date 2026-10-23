<script lang="ts">
	import { enhance } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let relinking = $state(false);
	let pollError = $state<string | null>(null);
	const pending = $derived(form?.pending ?? data.pending);
	const showForm = $derived(!data.server || relinking);

	// Poll for approval while a PIN is pending.
	$effect(() => {
		if (!pending) return;
		pollError = null;
		const timer = setInterval(async () => {
			const response = await fetch('/api/admin/plex/link');
			const result = await response.json();
			if (result.status === 'linked' || result.status === 'idle') {
				clearInterval(timer);
				relinking = false;
				await refreshAll();
			} else if (result.status === 'error') {
				clearInterval(timer);
				pollError = result.message;
			}
		}, 2000);
		return () => clearInterval(timer);
	});
</script>

<svelte:head>
	<title>Plex server · Admin · OpenPlexFrontEnd</title>
</svelte:head>

<div class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
	<a href={resolve('/(app)/admin/users')} class="btn-link self-start text-sm">← Users</a>
	<h1 class="text-2xl font-bold">Plex server</h1>

	{#if data.server}
		<section class="card p-5" aria-labelledby="server-heading" data-testid="plex-server">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 id="server-heading" class="text-lg font-semibold">{data.server.serverName}</h2>
					<p class="hint">{data.server.serverUrl} · version {data.server.serverVersion}</p>
				</div>
				{#if data.server.connected}
					<span class="rounded bg-surface-2 px-2 py-1 text-sm font-semibold text-success"
						>Connected</span
					>
				{:else}
					<span class="rounded bg-surface-2 px-2 py-1 text-sm font-semibold text-danger"
						>Unreachable</span
					>
				{/if}
			</div>
			{#if !relinking}
				<button type="button" class="btn btn-secondary mt-4" onclick={() => (relinking = true)}>
					Link a different server
				</button>
			{/if}
		</section>
	{/if}

	{#if showForm}
		<section class="card p-5" aria-labelledby="link-heading">
			<h2 id="link-heading" class="text-lg font-semibold">Link your Plex server</h2>
			{#if pending}
				<div class="mt-4 flex flex-col gap-4">
					<p>
						Open <a
							class="btn-link"
							href="https://plex.tv/link"
							target="_blank"
							rel="noopener noreferrer">plex.tv/link</a
						>, sign in as the server owner and enter this code:
					</p>
					<p
						class="rounded-lg bg-bg py-4 text-center font-mono text-4xl font-bold tracking-[0.3em]"
						data-testid="plex-pin"
					>
						{pending.code}
					</p>
					{#if pollError}
						<p class="alert alert-error" role="alert">{pollError}</p>
					{:else}
						<p class="hint" role="status">Waiting for approval…</p>
					{/if}
				</div>
			{:else}
				<p class="hint mt-1">
					The app connects to Plex from the server side. Plex itself does not need to be reachable
					from the internet.
				</p>
				<form method="POST" action="?/start" class="mt-4 flex flex-col gap-4" use:enhance>
					{#if form?.error}
						<p class="alert alert-error" role="alert">{form.error}</p>
					{/if}
					<div class="field">
						<label for="serverUrl">Server address</label>
						<input
							id="serverUrl"
							name="serverUrl"
							class="input font-mono"
							defaultValue={form?.serverUrl ?? data.defaultUrl}
							autocomplete="off"
							spellcheck="false"
							required
						/>
					</div>
					<div>
						<button class="btn btn-primary">Connect</button>
					</div>
				</form>
			{/if}
		</section>
	{/if}
</div>
