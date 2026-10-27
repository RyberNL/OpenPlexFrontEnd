import { describe, expect, it } from 'vitest';
import { parseChangelog } from './changelog';
import changelog from '../../CHANGELOG.md?raw';
import { APP_VERSION } from './version';

describe('changelog', () => {
	it('reads releases, sections and items, as plain text', () => {
		const releases = parseChangelog(
			[
				'# Changelog',
				'',
				'## [0.2.0] - 2026-10-24',
				'',
				'### Added',
				'',
				'- **AirPlay** and `Chromecast`, see [the guide](docs/player.md)',
				'  on more lines.',
				'',
				'### Fixed',
				'- Live TV stopping',
				'',
				'## [0.1.0] - 2026-10-23',
				'- First release'
			].join('\n')
		);
		expect(releases).toEqual([
			{
				version: '0.2.0',
				date: '2026-10-24',
				sections: [
					{ title: 'Added', items: ['AirPlay and Chromecast, see the guide on more lines.'] },
					{ title: 'Fixed', items: ['Live TV stopping'] }
				]
			},
			{ version: '0.1.0', date: '2026-10-23', sections: [{ title: '', items: ['First release'] }] }
		]);
	});

	it('has an entry for the current version at the top', () => {
		expect(parseChangelog(changelog)[0].version).toBe(APP_VERSION);
	});
});
