import { describe, expect, it } from 'vitest';
import { makeItem } from '#lib/test-items.js';
import { followingEpisode, pickNextEpisode } from './api';

const ep = (
	season: number,
	index: number,
	state: 'watched' | 'unwatched' | 'progress' = 'unwatched'
) =>
	makeItem({
		id: `${season}-${index}`,
		type: 'episode',
		parentIndex: season,
		index,
		watched: state === 'watched',
		viewOffset: state === 'progress' ? 60_000 : undefined
	});

describe('pickNextEpisode', () => {
	it('continues after the last watched episode (S01E01–E03 watched → S01E04)', () => {
		const episodes = [
			ep(1, 1, 'watched'),
			ep(1, 2, 'watched'),
			ep(1, 3, 'watched'),
			ep(1, 4),
			ep(1, 5)
		];
		expect(pickNextEpisode(episodes)?.id).toBe('1-4');
	});

	it('crosses into the next season', () => {
		expect(pickNextEpisode([ep(1, 1, 'watched'), ep(1, 2, 'watched'), ep(2, 1)])?.id).toBe('2-1');
	});

	it('prefers an episode in progress', () => {
		expect(pickNextEpisode([ep(1, 1, 'watched'), ep(1, 2), ep(1, 3, 'progress')])?.id).toBe('1-3');
	});

	it('falls back to the first unwatched episode when the last one was watched', () => {
		const episodes = [ep(1, 1, 'watched'), ep(1, 2), ep(1, 3, 'watched')];
		expect(pickNextEpisode(episodes)?.id).toBe('1-2');
	});

	it('returns null when everything is watched, and sorts unsorted input', () => {
		expect(pickNextEpisode([ep(1, 2, 'watched'), ep(1, 1, 'watched')])).toBeNull();
		expect(pickNextEpisode([ep(1, 3), ep(1, 1, 'watched'), ep(1, 2, 'watched')])?.id).toBe('1-3');
	});
});

describe('followingEpisode', () => {
	it('is the next episode in order, across seasons, regardless of watched state', () => {
		const episodes = [ep(2, 1, 'watched'), ep(1, 2), ep(1, 1), ep(1, 3, 'watched')];
		expect(followingEpisode(episodes, '1-1')?.id).toBe('1-2');
		expect(followingEpisode(episodes, '1-2')?.id).toBe('1-3');
		expect(followingEpisode(episodes, '1-3')?.id).toBe('2-1');
	});

	it('is null after the last episode or for an unknown one', () => {
		const episodes = [ep(1, 1), ep(1, 2)];
		expect(followingEpisode(episodes, '1-2')).toBeNull();
		expect(followingEpisode(episodes, 'nope')).toBeNull();
	});
});
