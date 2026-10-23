import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { makeItem } from '#lib/test-items.js';
import PosterCard from './PosterCard.svelte';

describe('PosterCard', () => {
	it('links to the item and shows title and year', () => {
		render(PosterCard, { item: makeItem({ id: '160', title: '2 Fast 2 Furious', year: 2003 }) });
		const link = screen.getByRole('link');
		expect(link).toHaveAttribute('href', '/item/160');
		expect(link).toHaveTextContent('2 Fast 2 Furious');
		expect(link).toHaveTextContent('2003');
	});

	it('marks fully watched items', () => {
		render(PosterCard, { item: makeItem({ watched: true }) });
		expect(screen.getByTestId('watched-badge')).toBeInTheDocument();
		expect(screen.queryByRole('progressbar')).toBeNull();
	});

	it('shows progress for partly watched items', () => {
		render(PosterCard, { item: makeItem({ viewOffset: 3_000_000, duration: 6_000_000 }) });
		const bar = screen.getByRole('progressbar');
		expect(bar).toHaveAttribute('aria-valuenow', '50');
		expect(bar.firstElementChild).toHaveStyle({ width: '50%' });
	});

	it('shows the unwatched episode count of a show', () => {
		render(PosterCard, {
			item: makeItem({ type: 'show', leafCount: 10, viewedLeafCount: 5, childCount: 2 })
		});
		expect(screen.getByTestId('unwatched-badge')).toHaveTextContent('5');
		expect(screen.getByLabelText('5 unwatched episodes')).toBeInTheDocument();
		expect(screen.getByRole('link')).toHaveTextContent('2 seasons');
	});

	it('labels episodes with show and episode number', () => {
		render(PosterCard, {
			item: makeItem({ type: 'episode', grandparentTitle: 'Dark', parentIndex: 1, index: 4 })
		});
		expect(screen.getByRole('link')).toHaveTextContent('Dark · S1 · E4');
	});

	it('falls back to the title when there is no artwork', () => {
		render(PosterCard, { item: makeItem({ title: 'No Art' }) });
		expect(screen.queryByRole('img')).toBeNull();
		expect(screen.getAllByText('No Art').length).toBeGreaterThan(0);
	});
});
