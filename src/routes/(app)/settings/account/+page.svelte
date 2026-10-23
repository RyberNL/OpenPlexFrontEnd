<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
</script>

<svelte:head>
	<title>Account · OpenPlexFrontEnd</title>
</svelte:head>

<div class="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-6">
	<h1 class="text-2xl font-bold">Account</h1>

	<section class="card p-5" aria-labelledby="sessions-heading">
		<h2 id="sessions-heading" class="text-lg font-semibold">Signed-in devices</h2>
		{#if form?.revokeError}
			<p class="alert alert-error mt-3" role="alert">{form.revokeError}</p>
		{/if}
		<ul class="mt-4 divide-y divide-border">
			{#each data.sessions as session (session.id)}
				<li class="flex flex-wrap items-center justify-between gap-3 py-3">
					<div>
						<p class="font-medium">
							{session.device}
							{#if session.current}
								<span class="ml-2 rounded bg-surface-2 px-2 py-0.5 text-xs text-accent"
									>This device</span
								>
							{/if}
						</p>
						<p class="hint">
							{session.ip ?? 'Unknown IP'} · last active {dateTime.format(session.lastSeenAt)}
						</p>
					</div>
					<form method="POST" action="?/revoke" use:enhance>
						<input type="hidden" name="id" value={session.id} />
						<button class="btn btn-secondary">{session.current ? 'Sign out' : 'Revoke'}</button>
					</form>
				</li>
			{/each}
		</ul>
	</section>

	<section class="card p-5" aria-labelledby="password-heading">
		<h2 id="password-heading" class="text-lg font-semibold">Change password</h2>
		<p class="hint mt-1">Changing your password signs you out on all other devices.</p>
		<form method="POST" action="?/password" class="mt-4 flex flex-col gap-4" use:enhance>
			{#if form?.passwordError}
				<p class="alert alert-error" role="alert">{form.passwordError}</p>
			{:else if form?.passwordChanged}
				<p class="alert alert-success" role="status">
					Password changed. Other devices have been signed out.
				</p>
			{/if}
			<!-- Lets password managers associate the change with the right account. -->
			<input type="hidden" name="username" autocomplete="username" value={data.username} />
			<div class="field">
				<label for="current">Current password</label>
				<input
					id="current"
					name="current"
					type="password"
					class="input"
					autocomplete="current-password"
					required
				/>
			</div>
			<div class="field">
				<label for="password">New password</label>
				<input
					id="password"
					name="password"
					type="password"
					class="input"
					autocomplete="new-password"
					minlength="12"
					maxlength="128"
					required
				/>
			</div>
			<div class="field">
				<label for="confirm">Confirm new password</label>
				<input
					id="confirm"
					name="confirm"
					type="password"
					class="input"
					autocomplete="new-password"
					required
				/>
			</div>
			<div>
				<button class="btn btn-primary">Change password</button>
			</div>
		</form>
	</section>

	<form method="POST" action="/logout">
		<button class="btn btn-secondary w-full sm:w-auto">Sign out</button>
	</form>
</div>
