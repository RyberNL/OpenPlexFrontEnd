/** Parsing of text subtitles (SRT, WebVTT, and plain ASS dialogue) into timed cues. */

export type Cue = { start: number; end: number; text: string };

/** "00:01:02,345", "01:02.345", "0:01:02.34" → seconds. */
function timestamp(value: string) {
	const match = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/.exec(value.trim());
	if (!match) return NaN;
	const [, h = '0', m, s, frac] = match;
	return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(frac.padEnd(3, '0')) / 1000;
}

const stripTags = (text: string) =>
	text
		.replace(/<\/?(?:[ibu]|font)[^>]*>/gi, '')
		.replace(/<[^>]+>/g, '')
		.trim();

/** SRT and WebVTT: blocks separated by blank lines, each with a "start --> end" line. */
export function parseSrtOrVtt(text: string): Cue[] {
	const cues: Cue[] = [];
	for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
		const lines = block.split('\n');
		const timing = lines.findIndex((l) => l.includes('-->'));
		if (timing < 0) continue;
		const [from, to] = lines[timing].split('-->');
		const start = timestamp(from);
		const end = timestamp(to.split(/\s+/).filter(Boolean)[0] ?? '');
		const body = stripTags(lines.slice(timing + 1).join('\n'));
		if (Number.isFinite(start) && Number.isFinite(end) && body)
			cues.push({ start, end, text: body });
	}
	return cues;
}

/** One ASS "Dialogue:" line → cue (override tags removed, \N as line breaks). */
export function parseAssDialogue(line: string, format = DEFAULT_FORMAT): Cue | null {
	if (!line.startsWith('Dialogue:')) return null;
	const fields = line.slice('Dialogue:'.length).trim().split(',');
	const at = (name: string) => format.indexOf(name);
	const textIndex = at('Text');
	if (textIndex < 0 || fields.length <= textIndex) return null;
	const text = fields
		.slice(textIndex)
		.join(',')
		.replace(/\{[^}]*\}/g, '')
		.replace(/\\N/gi, '\n')
		.replace(/\\h/g, ' ')
		.trim();
	const start = timestamp(fields[at('Start')] ?? '');
	const end = timestamp(fields[at('End')] ?? '');
	return text && Number.isFinite(start) && Number.isFinite(end) ? { start, end, text } : null;
}

const DEFAULT_FORMAT = [
	'Layer',
	'Start',
	'End',
	'Style',
	'Name',
	'MarginL',
	'MarginR',
	'MarginV',
	'Effect',
	'Text'
];

/** Parses ASS/SSA text (complete or partial) into plain cues. */
export function parseAss(text: string): Cue[] {
	let format = DEFAULT_FORMAT;
	let inEvents = false;
	const cues: Cue[] = [];
	for (const raw of text.replace(/\r/g, '').split('\n')) {
		const line = raw.trim();
		if (line.startsWith('[')) inEvents = line.toLowerCase() === '[events]';
		else if (inEvents && line.startsWith('Format:')) {
			format = line
				.slice('Format:'.length)
				.split(',')
				.map((f) => f.trim());
		} else if (inEvents) {
			const cue = parseAssDialogue(line, format);
			if (cue) cues.push(cue);
		}
	}
	return cues;
}

const isAss = (text: string) => /^\s*\[Script Info\]/i.test(text) || /\n\[Events\]/i.test(text);

/** Detects the format from the content and parses it. */
export function parseSubtitles(text: string): Cue[] {
	return isAss(text) ? parseAss(text) : parseSrtOrVtt(text);
}

/**
 * The part of a subtitle that is still arriving which can't change any more: up to the last line
 * break for ASS (one event per line), up to the last blank line for SRT and WebVTT (one cue per
 * block). A cue cut off mid-text would otherwise be shown, and kept, beside the complete one.
 */
export function settledPart(text: string) {
	const normalized = text.replace(/\r/g, '');
	if (isAss(normalized)) return normalized.slice(0, normalized.lastIndexOf('\n') + 1);
	const blank = normalized.lastIndexOf('\n\n');
	return blank < 0 ? '' : normalized.slice(0, blank + 2);
}

/** Cues showing at `time` (seconds). */
export function activeCues(cues: Cue[], time: number) {
	return cues.filter((c) => c.start <= time && time < c.end);
}
