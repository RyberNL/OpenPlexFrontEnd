import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Keys as written in docs/player.md → KeyboardEvent.key. */
const DOC_NAMES: Record<string, string> = {
	Space: ' ',
	'→': 'ArrowRight',
	'←': 'ArrowLeft',
	'↑': 'ArrowUp',
	'↓': 'ArrowDown',
	Esc: 'Escape'
};

describe('docs/player.md', () => {
	it('documents exactly the keys the player handles', () => {
		const source = fs.readFileSync('src/lib/player/Player.svelte', 'utf8');
		const handler = source.slice(source.indexOf('function onKeydown'));
		const implemented = [
			...handler.slice(0, handler.indexOf('\n\t}\n')).matchAll(/case '([^']+)':/g)
		].map((m) => m[1]);

		const doc = fs.readFileSync('docs/player.md', 'utf8');
		const section = doc.slice(doc.indexOf('## Keyboard shortcuts'), doc.indexOf('## Touch'));
		const documented = section
			.split('\n')
			.filter((line) => line.startsWith('| `'))
			.flatMap((line) => [...line.split('|')[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]))
			.map((key) => DOC_NAMES[key] ?? key);

		expect(implemented.length).toBeGreaterThan(10);
		expect([...documented].sort()).toEqual([...implemented].sort());
	});
});
