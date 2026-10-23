import { describe, expect, it } from 'vitest';
import { parseQueue, queueOrder, queuePosition } from './queue';

describe('play queues', () => {
	it('parses playlist and collection queues only', () => {
		expect(parseQueue('playlist:890001')).toEqual({ source: 'playlist', id: '890001' });
		expect(parseQueue('collection:12')).toEqual({ source: 'collection', id: '12' });
		expect(parseQueue('show:12')).toBeNull();
		expect(parseQueue('playlist:../x')).toBeNull();
		expect(parseQueue(null)).toBeNull();
	});

	it('keeps the listed order without a seed', () => {
		expect(queueOrder(4)).toEqual([0, 1, 2, 3]);
	});

	it('shuffles into a permutation that is the same for the same seed', () => {
		const order = queueOrder(20, 12345);
		expect([...order].sort((a, b) => a - b)).toEqual(queueOrder(20));
		expect(order).not.toEqual(queueOrder(20));
		expect(queueOrder(20, 12345)).toEqual(order);
		expect(queueOrder(20, 54321)).not.toEqual(order);
	});

	it('finds the position of the current item, preferring the given one for duplicates', () => {
		const ids = ['a', 'b', 'a', 'c'];
		const order = [0, 1, 2, 3];
		expect(queuePosition(ids, order, 'a')).toBe(0);
		expect(queuePosition(ids, order, 'a', 2)).toBe(2);
		expect(queuePosition(ids, order, 'c', 0)).toBe(3);
		expect(queuePosition(ids, order, 'z')).toBe(-1);
	});
});
