import { describe, expect, it } from 'vitest';
import { columnsFor, gridHeight, offsetOf, pagesToLoad, visibleRange } from './virtual';

const metrics = { columns: 4, rowHeight: 300, gap: 20 };

describe('virtual grid math', () => {
	it('fits columns to the width', () => {
		expect(columnsFor(360, 150, 12)).toBe(2);
		expect(columnsFor(1920, 160, 16)).toBe(11);
		expect(columnsFor(100, 150, 12)).toBe(1);
	});

	it('renders only rows near the viewport', () => {
		// Rows are 320px apart; viewport shows rows 10–12.
		expect(visibleRange(1000, metrics, 3200, 900, 1)).toEqual({ start: 36, end: 56 });
		expect(visibleRange(1000, metrics, 0, 900, 2)).toEqual({ start: 0, end: 20 });
	});

	it('clamps to the item count', () => {
		expect(visibleRange(10, metrics, 0, 5000)).toEqual({ start: 0, end: 10 });
		expect(visibleRange(0, metrics, 0, 900)).toEqual({ start: 0, end: 0 });
	});

	it('computes total height and row offsets', () => {
		expect(gridHeight(9, metrics)).toBe(3 * 300 + 2 * 20);
		expect(gridHeight(0, metrics)).toBe(0);
		expect(offsetOf(9, metrics)).toBe(640);
	});

	it('lists pages that still need loading', () => {
		expect(pagesToLoad(35, 130, 50, new Set([0]))).toEqual([50, 100]);
		expect(pagesToLoad(0, 40, 50, new Set([0]))).toEqual([]);
	});
});
