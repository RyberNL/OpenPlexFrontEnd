<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Playback · OpenPlexFrontEnd</title>
</svelte:head>

<div class="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-6">
	<h1 class="text-2xl font-bold">Playback</h1>
	<form
		method="POST"
		class="card flex flex-col gap-5 p-5"
		use:enhance={() =>
			async ({ update }) =>
				update({ reset: false })}
	>
		{#if form?.saved}<p class="alert alert-success" role="status">Settings saved.</p>{/if}
		{#if form?.error}<p class="alert alert-error" role="alert">{form.error}</p>{/if}
		<div class="field">
			<label for="quality">Default quality</label>
			<select id="quality" name="quality" class="input">
				{#each data.qualities as q (q.value)}
					<option value={q.value} selected={data.prefs.quality === q.value}>{q.label}</option>
				{/each}
			</select>
			<p class="hint">
				Lower qualities use less data; “Original” plays files directly when possible.
			</p>
		</div>
		<fieldset class="grid gap-4 sm:grid-cols-2">
			<legend class="label mb-2">Subtitle appearance</legend>
			<div class="field">
				<label for="subtitleSize">Size</label>
				<select id="subtitleSize" name="subtitleSize" class="input">
					{#each [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['xlarge', 'Extra large']] as [value, label] (value)}
						<option {value} selected={data.prefs.subtitleSize === value}>{label}</option>
					{/each}
				</select>
			</div>
			<div class="field">
				<label for="subtitleColor">Colour</label>
				<select id="subtitleColor" name="subtitleColor" class="input">
					{#each [['white', 'White'], ['yellow', 'Yellow'], ['cyan', 'Cyan']] as [value, label] (value)}
						<option {value} selected={data.prefs.subtitleColor === value}>{label}</option>
					{/each}
				</select>
			</div>
			<div class="field">
				<label for="subtitleBackground">Background opacity</label>
				<input
					id="subtitleBackground"
					name="subtitleBackground"
					type="range"
					min="0"
					max="1"
					step="0.1"
					value={data.prefs.subtitleBackground}
					class="h-11 accent-[var(--color-accent)]"
				/>
			</div>
			<div class="field">
				<label for="subtitlePosition">Position</label>
				<select id="subtitlePosition" name="subtitlePosition" class="input">
					<option value="bottom" selected={data.prefs.subtitlePosition === 'bottom'}>Bottom</option>
					<option value="raised" selected={data.prefs.subtitlePosition === 'raised'}>Raised</option>
				</select>
			</div>
			<label class="flex min-h-11 items-center gap-3 sm:col-span-2">
				<input
					type="checkbox"
					name="simpleSubtitles"
					checked={data.prefs.simpleSubtitles}
					class="h-5 w-5 rounded border-border bg-bg text-accent"
				/>
				Simple subtitles: show styled (ASS/SSA) subtitles as plain text with this appearance
			</label>
		</fieldset>
		<fieldset class="flex flex-col gap-2">
			<legend class="label mb-1">Automatic</legend>
			{#each [{ name: 'autoplayNext', label: 'Play the next episode automatically', checked: data.prefs.autoplayNext }, { name: 'autoSkipIntro', label: 'Skip intros automatically', checked: data.prefs.autoSkipIntro }, { name: 'autoSkipCredits', label: 'Skip credits automatically', checked: data.prefs.autoSkipCredits }] as option (option.name)}
				<label class="flex min-h-11 items-center gap-3">
					<input
						type="checkbox"
						name={option.name}
						checked={option.checked}
						class="h-5 w-5 rounded border-border bg-bg text-accent"
					/>
					{option.label}
				</label>
			{/each}
		</fieldset>
		<div><button class="btn btn-primary">Save</button></div>
	</form>
</div>
