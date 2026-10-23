import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { makeItem } from '#lib/test-items.js';
import HubRow from './HubRow.svelte';

describe('HubRow', () => {
	it('renders a titled, scrollable list of cards', () => {
		render(HubRow, {
			title: 'Recently Added',
			items: [makeItem({ id: '1', title: 'One' }), makeItem({ id: '2', title: 'Two' })],
			moreHref: '/library/1'
		});
		const region = screen.getByRole('region', { name: 'Recently Added' });
		const list = within(region).getByRole('list', { name: 'Recently Added' });
		expect(within(list).getAllByRole('listitem')).toHaveLength(2);
		expect(within(region).getByRole('link', { name: 'See all' })).toHaveAttribute(
			'href',
			'/library/1'
		);
		expect(
			within(region).getByRole('button', { name: 'Scroll Recently Added forward' })
		).toBeInTheDocument();
	});
});
