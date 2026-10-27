export type Release = {
	version: string;
	date?: string;
	sections: { title: string; items: string[] }[];
};

/**
 * Reads CHANGELOG.md (Keep a Changelog style): `## [1.2.0] - 2026-10-24` per release, `### Added`
 * and the like per section, and `- ` items. Inline Markdown is reduced to plain text.
 */
export function parseChangelog(markdown: string): Release[] {
	const releases: Release[] = [];
	for (const line of markdown.split(/\r?\n/)) {
		const release = /^##\s+\[?([^\]\s]+)\]?(?:\s+-\s+(\S+))?/.exec(line);
		if (release) {
			releases.push({ version: release[1], date: release[2], sections: [] });
			continue;
		}
		const current = releases.at(-1);
		if (!current) continue;
		const section = /^###\s+(.+)/.exec(line);
		if (section) {
			current.sections.push({ title: section[1].trim(), items: [] });
			continue;
		}
		const item = /^[-*]\s+(.+)/.exec(line);
		if (item) {
			if (!current.sections.length) current.sections.push({ title: '', items: [] });
			current.sections.at(-1)!.items.push(plain(item[1]));
		} else if (/^\s{2,}\S/.test(line)) {
			// A wrapped item continues on an indented line.
			const items = current.sections.at(-1)?.items;
			if (items?.length) items[items.length - 1] += ` ${plain(line.trim())}`;
		}
	}
	return releases;
}

function plain(text: string) {
	return text
		.replace(/\*\*(.+?)\*\*/g, '$1')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}
