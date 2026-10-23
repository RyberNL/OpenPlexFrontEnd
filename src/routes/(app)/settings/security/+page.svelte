<script lang="ts">
	import { enhance } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import PasskeyButton from '#lib/components/PasskeyButton.svelte';
	import RecoveryCodes from '#lib/components/RecoveryCodes.svelte';
	import TotpEnroll from '#lib/components/TotpEnroll.svelte';
	import { registerPasskey, verifyWithPasskey } from '#lib/passkeys.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let editing = $state<string | null>(null);
	let addingTotp = $state(false);
	let passkeyAdded = $state(false);

	const verified = $derived(data.stepUpUntil !== null);
	const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
	const kindLabel = { passkey: 'Passkey', totp: 'Authenticator app' } as const;

	$effect(() => {
		if (form?.enrollment) addingTotp = true;
		if (form?.totpAdded) addingTotp = false;
	});
</script>

<svelte:head>
	<title>Security · OpenPlexFrontEnd</title>
</svelte:head>

<div class="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-6">
	<h1 class="text-2xl font-bold">Security</h1>

	<section class="card p-5" aria-labelledby="verify-heading" data-testid="step-up">
		<h2 id="verify-heading" class="text-lg font-semibold">Verify it’s you</h2>
		{#if verified}
			<p class="mt-1 text-muted" role="status">
				Verified. You can add or remove sign-in methods for the next few minutes.
			</p>
		{:else}
			<p class="mt-1 text-muted">
				Adding or removing sign-in methods requires confirming with one you already have.
			</p>
			<div class="mt-4 flex flex-col gap-4">
				{#if form?.stepUpError}
					<p class="alert alert-error" role="alert">{form.stepUpError}</p>
				{/if}
				{#if data.factors.some((f) => f.kind === 'passkey')}
					<PasskeyButton
						label="Verify with a passkey"
						variant="secondary"
						run={verifyWithPasskey}
						onDone={() => refreshAll()}
					/>
				{/if}
				{#if data.hasTotp}
					<form method="POST" action="?/stepUp" class="flex flex-wrap items-end gap-3" use:enhance>
						<div class="field grow">
							<label for="stepup-code">Authenticator code</label>
							<input
								id="stepup-code"
								name="code"
								class="input font-mono tracking-widest"
								inputmode="numeric"
								autocomplete="one-time-code"
								maxlength="7"
								required
							/>
						</div>
						<button class="btn btn-secondary">Verify</button>
					</form>
				{/if}
			</div>
		{/if}
	</section>

	<section class="card p-5" aria-labelledby="factors-heading">
		<h2 id="factors-heading" class="text-lg font-semibold">Sign-in methods</h2>
		{#if form?.factorError && !form.factorId}
			<p class="alert alert-error mt-3" role="alert">{form.factorError}</p>
		{/if}
		<ul class="mt-4 divide-y divide-border" aria-label="Sign-in methods">
			{#each data.factors as factor (factor.id)}
				<li class="flex flex-col gap-3 py-3">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div>
							<p class="font-medium">{factor.name}</p>
							<p class="hint">
								{kindLabel[factor.kind]} · added {date.format(factor.createdAt)}{factor.lastUsedAt
									? ` · last used ${date.format(factor.lastUsedAt)}`
									: ''}
							</p>
						</div>
						<div class="flex gap-2">
							<button
								type="button"
								class="btn btn-secondary"
								aria-label="Rename {factor.name}"
								onclick={() => (editing = editing === factor.id ? null : factor.id)}
							>
								Rename
							</button>
							<form method="POST" action="?/remove" use:enhance>
								<input type="hidden" name="kind" value={factor.kind} />
								<input type="hidden" name="id" value={factor.id} />
								<button class="btn btn-danger" aria-label="Remove {factor.name}">Remove</button>
							</form>
						</div>
					</div>
					{#if form?.factorError && form.factorId === factor.id}
						<p class="alert alert-error" role="alert">{form.factorError}</p>
					{/if}
					{#if editing === factor.id}
						<form
							method="POST"
							action="?/rename"
							class="flex flex-wrap items-end gap-3"
							use:enhance={() =>
								async ({ update, result }) => {
									await update();
									if (result.type === 'success') editing = null;
								}}
						>
							<input type="hidden" name="kind" value={factor.kind} />
							<input type="hidden" name="id" value={factor.id} />
							<div class="field grow">
								<label for="name-{factor.id}">New name</label>
								<input
									id="name-{factor.id}"
									name="name"
									class="input"
									value={factor.name}
									maxlength="64"
									required
								/>
							</div>
							<button class="btn btn-primary">Save</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>

		<div class="mt-4 flex flex-col gap-3 border-t border-border pt-4">
			<h3 class="font-semibold">Add a sign-in method</h3>
			{#if passkeyAdded}
				<p class="alert alert-success" role="status">Passkey added.</p>
			{/if}
			{#if form?.totpAdded}
				<p class="alert alert-success" role="status">Authenticator app added.</p>
			{/if}
			<PasskeyButton
				label="Add a passkey"
				variant="secondary"
				run={() => registerPasskey()}
				onDone={() => {
					passkeyAdded = true;
					refreshAll();
				}}
			/>
			{#if form?.totpError && !form.enrollment}
				<p class="alert alert-error" role="alert">{form.totpError}</p>
			{/if}
			<TotpEnroll
				enrollment={addingTotp ? form?.enrollment : null}
				error={form?.enrollment ? form.totpError : null}
				refresh
				onCancel={() => (addingTotp = false)}
			/>
		</div>
	</section>

	<section class="card p-5" aria-labelledby="recovery-heading">
		<h2 id="recovery-heading" class="text-lg font-semibold">Recovery codes</h2>
		{#if form?.recoveryCodes}
			<div class="mt-4">
				<RecoveryCodes codes={form.recoveryCodes} />
			</div>
		{:else}
			<p class="mt-1 text-muted">
				{data.recoveryCodesLeft} of 10 unused codes left. Generating new codes invalidates all earlier
				ones.
			</p>
			<form
				method="POST"
				action="?/regenerateRecoveryCodes"
				class="mt-4 flex flex-col gap-3"
				use:enhance={() =>
					async ({ update }) => {
						await update({ refreshAll: false });
					}}
			>
				{#if form?.recoveryError}
					<p class="alert alert-error" role="alert">{form.recoveryError}</p>
				{/if}
				<div>
					<button class="btn btn-secondary">Generate new recovery codes</button>
				</div>
			</form>
		{/if}
	</section>
</div>
