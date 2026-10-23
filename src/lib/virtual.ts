/** Pure layout math for the virtualized poster grid. */

export type GridMetrics = { columns: number; rowHeight: number; gap: number };

/** Columns that fit `width` with cards at least `minCardWidth` wide. */
export function columnsFor(width: number, minCardWidth: number, gap: number) {
	return Math.max(1, Math.floor((width + gap) / (minCardWidth + gap)));
}

/**
 * Item index range [start, end) to render for the visible window, padded by `overscanRows` rows
 * above and below.
 */
export function visibleRange(
	total: number,
	metrics: GridMetrics,
	viewportTop: number,
	viewportHeight: number,
	overscanRows = 2
) {
	const rowStride = metrics.rowHeight + metrics.gap;
	if (total === 0 || rowStride <= 0) return { start: 0, end: 0 };
	const firstRow = Math.max(0, Math.floor(viewportTop / rowStride) - overscanRows);
	const lastRow = Math.ceil((viewportTop + viewportHeight) / rowStride) + overscanRows;
	return {
		start: Math.min(total, firstRow * metrics.columns),
		end: Math.min(total, lastRow * metrics.columns)
	};
}

/** Total scroll height of the grid. */
export function gridHeight(total: number, metrics: GridMetrics) {
	const rows = Math.ceil(total / metrics.columns);
	return rows === 0 ? 0 : rows * metrics.rowHeight + (rows - 1) * metrics.gap;
}

/** Offset from the grid top of the row containing `index`. */
export function offsetOf(index: number, metrics: GridMetrics) {
	return Math.floor(index / metrics.columns) * (metrics.rowHeight + metrics.gap);
}

/** Page offsets (multiples of `pageSize`) needed for [start, end) that are not loaded yet. */
export function pagesToLoad(
	start: number,
	end: number,
	pageSize: number,
	loaded: ReadonlySet<number>
) {
	const pages: number[] = [];
	for (let page = Math.floor(start / pageSize) * pageSize; page < end; page += pageSize) {
		if (!loaded.has(page)) pages.push(page);
	}
	return pages;
}
