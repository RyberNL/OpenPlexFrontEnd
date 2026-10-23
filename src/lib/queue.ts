/**
 * Play queues live in the watch URL: `queue=playlist:<id>` or `collection:<id>`, an optional
 * shuffle seed and the position in the queue. The order follows from the container's items and
 * the seed, so a shuffled queue plays each item exactly once without any stored state.
 */

export type QueueRef = { source: 'playlist' | 'collection'; id: string };

export function parseQueue(value: string | null | undefined): QueueRef | null {
	const match = /^(playlist|collection):(\d+)$/.exec(value ?? '');
	return match ? { source: match[1] as QueueRef['source'], id: match[2] } : null;
}

/** A new shuffle seed. */
export function newSeed() {
	return Math.floor(Math.random() * 0x7fffffff) + 1;
}

/** Deterministic PRNG (mulberry32) for a seed. */
function random(seed: number) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** The play order of `length` items as indexes: as listed, or shuffled by `seed`. */
export function queueOrder(length: number, seed?: number): number[] {
	const order = Array.from({ length }, (_, i) => i);
	if (!seed) return order;
	const next = random(seed);
	for (let i = length - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		[order[i], order[j]] = [order[j], order[i]];
	}
	return order;
}

/**
 * Where the current item is in the queue: `pos` when it matches, else the item's first
 * occurrence (a playlist may contain an item twice). -1 when the item isn't in the queue.
 */
export function queuePosition(ids: string[], order: number[], currentId: string, pos?: number) {
	if (pos !== undefined && ids[order[pos]] === currentId) return pos;
	return order.findIndex((i) => ids[i] === currentId);
}
