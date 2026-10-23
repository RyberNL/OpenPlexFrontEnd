<script lang="ts">
	import { enhance } from '$app/forms';

	type Enrollment = { enrollmentId: string; secret: string; qrDataUrl: string };

	let {
		enrollment,
		error,
		startAction = '?/totpStart',
		confirmAction = '?/totpConfirm',
		refresh = false,
		onCancel
	}: {
		enrollment: Enrollment | null | undefined;
		error?: string | null;
		startAction?: string;
		confirmAction?: string;
		/** Reload page data after a successful submission (not wanted mid sign-in). */
		refresh?: boolean;
		onCancel?: () => void;
	} = $props();

	let submitting = $state(false);
	const grouped = $derived(enrollment?.secret.match(/.{1,4}/g)?.join(' ') ?? '');

	const submit = () => {
		submitting = true;
		return async ({
			update
		}: {
			update: (o?: { reset?: boolean; refreshAll?: boolean }) => Promise<void>;
		}) => {
			// During enrollment, the session changes level on success and the response (e.g.
			// recovery codes) must be shown before any data reload could redirect.
			await update({ reset: false, refreshAll: refresh });
			submitting = false;
		};
	};
</script>

{#if !enrollment}
	<form method="POST" action={startAction} use:enhance={submit}>
		<button class="btn btn-secondary w-full" disabled={submitting}>Use an authenticator app</button>
	</form>
{:else}
	<div class="flex flex-col gap-4">
		<ol class="list-decimal space-y-1 pl-5 text-sm text-muted">
			<li>Open Google Authenticator or another authenticator app.</li>
			<li>Scan the QR code, or enter the setup key by hand.</li>
			<li>Enter the 6-digit code the app shows.</li>
		</ol>
		<img
			src={enrollment.qrDataUrl}
			alt="QR code for your authenticator app"
			class="mx-auto h-48 w-48 rounded-lg bg-white p-2"
		/>
		<div>
			<p class="label">Setup key</p>
			<p
				class="mt-1 rounded-md bg-bg px-3 py-2 font-mono text-sm break-all"
				data-testid="totp-secret"
			>
				{grouped}
			</p>
		</div>
		<form method="POST" action={confirmAction} class="flex flex-col gap-4" use:enhance={submit}>
			{#if error}
				<p class="alert alert-error" role="alert">{error}</p>
			{/if}
			<input type="hidden" name="enrollmentId" value={enrollment.enrollmentId} />
			<div class="field">
				<label for="totp-code">6-digit code</label>
				<input
					id="totp-code"
					name="code"
					class="input font-mono tracking-widest"
					inputmode="numeric"
					autocomplete="one-time-code"
					pattern={'[0-9 ]{6,7}'}
					maxlength="7"
					required
				/>
			</div>
			<div class="field">
				<label for="totp-name">Name</label>
				<input id="totp-name" name="name" class="input" value="Authenticator app" maxlength="64" />
				<p class="hint">Helps you tell your authenticators apart.</p>
			</div>
			<div class="flex flex-wrap gap-3">
				<button class="btn btn-primary" disabled={submitting}>Verify and save</button>
				{#if onCancel}
					<button type="button" class="btn btn-secondary" onclick={onCancel}>Cancel</button>
				{/if}
			</div>
		</form>
	</div>
{/if}
