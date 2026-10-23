<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const user = $derived(data.user);

	const confirmFirst =
		(message: string): SubmitFunction =>
		({ cancel }) => {
			if (!confirm(message)) cancel();
		};
</script>

<svelte:head>
	<title>{user.displayName} · Users · OpenPlexFrontEnd</title>
</svelte:head>

<div class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
	<a href={resolve('/(app)/admin/users')} class="btn-link self-start text-sm">← All users</a>
	<div>
		<h1 class="text-2xl font-bold">{user.displayName}</h1>
		<p class="text-muted">
			@{user.username} · {user.role === 'admin' ? 'Administrator' : 'User'}{user.disabled
				? ' · Disabled'
				: ''}
		</p>
	</div>

	{#if data.created}
		<p class="alert alert-success" role="status">
			User created. Share the temporary password with them; they will choose their own and set up
			two-factor authentication at first sign-in.
		</p>
	{/if}
	{#if form?.error}
		<p class="alert alert-error" role="alert">{form.error}</p>
	{:else if form?.saved}
		<p class="alert alert-success" role="status">Changes saved.</p>
	{:else if form?.disabled}
		<p class="alert alert-success" role="status">User disabled and signed out everywhere.</p>
	{:else if form?.enabled}
		<p class="alert alert-success" role="status">User enabled.</p>
	{:else if form?.mfaReset}
		<p class="alert alert-success" role="status">
			Two-factor authentication reset. They will set it up again at their next sign-in.
		</p>
	{/if}

	<section class="card p-5" aria-labelledby="details-heading">
		<h2 id="details-heading" class="text-lg font-semibold">Details</h2>
		<form method="POST" action="?/update" class="mt-4 grid gap-4 sm:grid-cols-2" use:enhance>
			<div class="field">
				<label for="displayName">Display name</label>
				<input
					id="displayName"
					name="displayName"
					class="input"
					defaultValue={user.displayName}
					maxlength="64"
					required
				/>
			</div>
			<div class="field">
				<label for="role">Role</label>
				<select id="role" name="role" class="input" disabled={data.isSelf}>
					<option value="user" selected={user.role === 'user'}>User</option>
					<option value="admin" selected={user.role === 'admin'}>Administrator</option>
				</select>
				{#if data.isSelf}
					<input type="hidden" name="role" value={user.role} />
					<p class="hint">You can’t change your own role.</p>
				{/if}
			</div>
			<div class="sm:col-span-2">
				<button class="btn btn-primary">Save</button>
			</div>
		</form>
	</section>

	<section class="card p-5" aria-labelledby="plex-heading">
		<h2 id="plex-heading" class="text-lg font-semibold">Plex user</h2>
		<p class="mt-1 text-muted">
			Watch history, Continue Watching and library access follow this Plex Home user.
		</p>
		{#if !data.linked}
			<p class="alert alert-info mt-4">
				Link a Plex server first under <a class="btn-link" href={resolve('/(app)/admin/plex')}
					>Plex server</a
				>.
			</p>
		{:else if data.homeUsersError}
			<p class="alert alert-error mt-4" role="alert">{data.homeUsersError}</p>
		{:else}
			<form method="POST" action="?/mapPlex" class="mt-4 grid gap-4 sm:grid-cols-2" use:enhance>
				{#if form?.plexError}
					<p class="alert alert-error sm:col-span-2" role="alert">{form.plexError}</p>
				{:else if form?.plexMapped}
					<p class="alert alert-success sm:col-span-2" role="status">
						Linked to Plex user {form.plexMapped}.
					</p>
				{:else if form?.plexCleared}
					<p class="alert alert-success sm:col-span-2" role="status">Plex link removed.</p>
				{/if}
				<div class="field">
					<label for="homeUser">Plex Home user</label>
					<select id="homeUser" name="homeUser" class="input">
						<option value="" selected={!user.plexHomeUserUuid}>Not linked</option>
						{#each data.homeUsers as home (home.uuid)}
							<option value={home.uuid} selected={user.plexHomeUserUuid === home.uuid}>
								{home.title}{home.admin ? ' (owner)' : ''}{home.protected ? ' 🔒' : ''}
							</option>
						{/each}
					</select>
				</div>
				<div class="field">
					<label for="pin">Plex Home PIN</label>
					<input
						id="pin"
						name="pin"
						class="input font-mono"
						inputmode="numeric"
						autocomplete="off"
						maxlength="4"
					/>
					<p class="hint">Only for PIN-protected users (🔒). Stored encrypted.</p>
				</div>
				<div class="sm:col-span-2">
					<button class="btn btn-primary">Save Plex user</button>
				</div>
			</form>
		{/if}
	</section>

	<section class="card p-5" aria-labelledby="mfa-heading">
		<h2 id="mfa-heading" class="text-lg font-semibold">Two-factor authentication</h2>
		<p class="mt-1 text-muted">
			{user.passkeys + user.totps > 0
				? `${user.passkeys} passkey(s) and ${user.totps} authenticator app(s).`
				: 'Not set up yet. They will be asked at their next sign-in.'}
		</p>
		<form
			method="POST"
			action="?/resetMfa"
			class="mt-4"
			use:enhance={confirmFirst(
				`Reset two-factor authentication for ${user.username}? Their passkeys, authenticator apps and recovery codes are removed and they are signed out everywhere.`
			)}
		>
			<button class="btn btn-secondary">Reset two-factor</button>
		</form>
	</section>

	{#if !data.isSelf}
		<section class="card p-5" aria-labelledby="access-heading">
			<h2 id="access-heading" class="text-lg font-semibold">Access</h2>
			<div class="mt-4 flex flex-wrap gap-3">
				{#if user.disabled}
					<form method="POST" action="?/enable" use:enhance>
						<button class="btn btn-secondary">Enable user</button>
					</form>
				{:else}
					<form method="POST" action="?/disable" use:enhance>
						<button class="btn btn-secondary">Disable user</button>
					</form>
				{/if}
				<form
					method="POST"
					action="?/delete"
					use:enhance={confirmFirst(`Delete ${user.username} permanently?`)}
				>
					<button class="btn btn-danger">Delete user</button>
				</form>
			</div>
		</section>
	{/if}
</div>
