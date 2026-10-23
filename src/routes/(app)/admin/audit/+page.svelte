<script lang="ts">
	import { resolve } from '$app/paths';
	import { AUDIT_LABELS } from '#lib/audit-labels.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const time = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium' });

	function describe(detail: Record<string, unknown> | null) {
		if (!detail) return '';
		return Object.entries(detail)
			.map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
			.join(', ');
	}
</script>

<svelte:head>
	<title>Audit log · Admin · OpenPlexFrontEnd</title>
</svelte:head>

<div class="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">
	<a href={resolve('/(app)/admin/users')} class="btn-link self-start text-sm">← Users</a>
	<h1 class="text-2xl font-bold">Audit log</h1>

	<form method="GET" class="card flex flex-wrap items-end gap-4 p-4" data-sveltekit-keepfocus>
		<div class="field min-w-40 grow">
			<label for="filter-user">User</label>
			<select id="filter-user" name="user" class="input">
				<option value="">All users</option>
				{#each data.users as user (user.id)}
					<option value={user.id} selected={data.filters.user === user.id}>{user.username}</option>
				{/each}
			</select>
		</div>
		<div class="field min-w-40 grow">
			<label for="filter-event">Event</label>
			<select id="filter-event" name="event" class="input">
				<option value="">All events</option>
				{#each data.events as event (event)}
					<option value={event} selected={data.filters.event === event}
						>{AUDIT_LABELS[event] ?? event}</option
					>
				{/each}
			</select>
		</div>
		<button class="btn btn-secondary">Filter</button>
	</form>

	{#if data.entries.length === 0}
		<p class="text-muted">No matching entries.</p>
	{:else}
		<ol class="card divide-y divide-border" aria-label="Audit entries">
			{#each data.entries as entry (entry.id)}
				<li class="grid gap-1 p-4 sm:grid-cols-[11rem_1fr_auto] sm:gap-4">
					<time class="text-sm text-muted" datetime={new Date(entry.at).toISOString()}
						>{time.format(entry.at)}</time
					>
					<div>
						<p class="font-medium">{AUDIT_LABELS[entry.event] ?? entry.event}</p>
						<p class="hint">
							{#if entry.actorUsername && entry.actorUsername !== entry.targetUsername}
								by {entry.actorUsername}
							{/if}
							{#if entry.targetUsername}
								· account <span data-testid="audit-target">{entry.targetUsername}</span>
							{/if}
							{#if entry.detail}
								· {describe(entry.detail)}
							{/if}
						</p>
					</div>
					<p class="font-mono text-sm text-muted">{entry.ip ?? '—'}</p>
				</li>
			{/each}
		</ol>
		{#if data.olderThan}
			<form method="GET" class="self-start">
				{#if data.filters.user}<input type="hidden" name="user" value={data.filters.user} />{/if}
				{#if data.filters.event}<input type="hidden" name="event" value={data.filters.event} />{/if}
				<input type="hidden" name="before" value={data.olderThan} />
				<button class="btn btn-secondary">Older entries</button>
			</form>
		{/if}
	{/if}
</div>
