<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let showCreate = $state(false);

	const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

	$effect(() => {
		if (form?.createError) showCreate = true;
	});
</script>

<svelte:head>
	<title>Users · Admin · OpenPlexFrontEnd</title>
</svelte:head>

<div class="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h1 class="text-2xl font-bold">Users</h1>
		<div class="flex gap-2">
			<a class="btn btn-secondary" href={resolve('/(app)/admin/plex')}>Plex server</a>
			<a class="btn btn-secondary" href={resolve('/(app)/admin/audit')}>Audit log</a>
			<button
				type="button"
				class="btn btn-primary"
				aria-expanded={showCreate}
				onclick={() => (showCreate = !showCreate)}>Add user</button
			>
		</div>
	</div>

	{#if showCreate}
		<section class="card p-5" aria-labelledby="create-heading">
			<h2 id="create-heading" class="text-lg font-semibold">Add user</h2>
			<p class="hint mt-1">
				They sign in with this temporary password, then choose their own and set up two-factor
				authentication.
			</p>
			<form method="POST" action="?/create" class="mt-4 grid gap-4 sm:grid-cols-2" use:enhance>
				{#if form?.createError}
					<p class="alert alert-error sm:col-span-2" role="alert">{form.createError}</p>
				{/if}
				<div class="field">
					<label for="new-username">Username</label>
					<input
						id="new-username"
						name="username"
						class="input"
						autocomplete="off"
						autocapitalize="none"
						spellcheck="false"
						defaultValue={form?.username ?? ''}
						required
					/>
				</div>
				<div class="field">
					<label for="new-displayName">Display name</label>
					<input
						id="new-displayName"
						name="displayName"
						class="input"
						autocomplete="off"
						defaultValue={form?.displayName ?? ''}
					/>
				</div>
				<div class="field">
					<label for="new-password">Temporary password</label>
					<input
						id="new-password"
						name="password"
						type="text"
						class="input font-mono"
						autocomplete="off"
						minlength="12"
						maxlength="128"
						required
					/>
				</div>
				<div class="field">
					<label for="new-role">Role</label>
					<select id="new-role" name="role" class="input">
						<option value="user" selected={form?.role !== 'admin'}>User</option>
						<option value="admin" selected={form?.role === 'admin'}>Administrator</option>
					</select>
				</div>
				<div class="sm:col-span-2">
					<button class="btn btn-primary">Create user</button>
				</div>
			</form>
		</section>
	{/if}

	<ul class="card divide-y divide-border" aria-label="Users">
		{#each data.users as user (user.id)}
			<li>
				<a
					href={resolve('/(app)/admin/users/[id]', { id: user.id })}
					class="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-surface-2"
				>
					<div>
						<p class="font-medium">
							{user.displayName}
							<span class="text-muted">@{user.username}</span>
						</p>
						<p class="hint">
							{user.role === 'admin' ? 'Administrator' : 'User'} ·
							{user.passkeys + user.totps > 0
								? `${user.passkeys} passkey${user.passkeys === 1 ? '' : 's'}, ${user.totps} authenticator${user.totps === 1 ? '' : 's'}`
								: 'two-factor not set up'} ·
							{user.plexHomeUserTitle ? `Plex: ${user.plexHomeUserTitle}` : 'not linked to Plex'}
							{#if user.lastSeenAt}
								· last active {date.format(user.lastSeenAt)}{/if}
						</p>
					</div>
					{#if user.disabled}
						<span class="rounded bg-surface-2 px-2 py-1 text-xs font-semibold text-danger"
							>Disabled</span
						>
					{/if}
				</a>
			</li>
		{/each}
	</ul>
</div>
