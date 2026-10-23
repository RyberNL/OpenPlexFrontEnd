/**
 * BIF ("base index frames", Roku's format that Plex uses for preview thumbnails): a header, an
 * index of (timestamp, offset) pairs ending in a 0xffffffff timestamp, then JPEG frames back to
 * back. Each frame runs from its offset to the next entry's offset.
 */

const MAGIC = Buffer.from([0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEADER_SIZE = 64;
const END = 0xffffffff;

export type Bif = {
	/** Frame start times in ms, ascending. */
	times: number[];
	frame: (index: number) => Buffer;
};

export class BifError extends Error {}

export function parseBif(data: Buffer): Bif {
	if (data.length < HEADER_SIZE || !data.subarray(0, 8).equals(MAGIC)) {
		throw new BifError('Not a BIF file');
	}
	const count = data.readUInt32LE(12);
	// Timestamps are in units of this many ms; 0 means the default of 1000.
	const multiplier = data.readUInt32LE(16) || 1000;
	const indexEnd = HEADER_SIZE + (count + 1) * 8;
	if (indexEnd > data.length) throw new BifError('Truncated BIF index');

	const times: number[] = [];
	const offsets: number[] = [];
	for (let i = 0; i <= count; i++) {
		const at = HEADER_SIZE + i * 8;
		const timestamp = data.readUInt32LE(at);
		const offset = data.readUInt32LE(at + 4);
		if (i === count) {
			if (timestamp !== END) throw new BifError('Missing BIF index end');
		} else times.push(timestamp * multiplier);
		if (offset < indexEnd || offset > data.length || (offsets.length && offset < offsets.at(-1)!)) {
			throw new BifError('Invalid BIF frame offset');
		}
		offsets.push(offset);
	}
	return { times, frame: (index) => data.subarray(offsets[index], offsets[index + 1]) };
}

/** The index of the frame showing at `time` (ms): the last one starting at or before it. */
export function frameIndexAt(bif: Bif, time: number) {
	let low = 0;
	let high = bif.times.length - 1;
	if (high < 0) return -1;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if (bif.times[mid] <= time) low = mid;
		else high = mid - 1;
	}
	return low;
}

/** Builds a BIF from frames (for tests and fixtures). */
export function buildBif(frames: { time: number; jpeg: Buffer }[], multiplier = 1000) {
	const header = Buffer.alloc(HEADER_SIZE);
	MAGIC.copy(header);
	header.writeUInt32LE(0, 8);
	header.writeUInt32LE(frames.length, 12);
	header.writeUInt32LE(multiplier, 16);
	const index = Buffer.alloc((frames.length + 1) * 8);
	let offset = HEADER_SIZE + index.length;
	frames.forEach((f, i) => {
		index.writeUInt32LE(Math.round(f.time / multiplier), i * 8);
		index.writeUInt32LE(offset, i * 8 + 4);
		offset += f.jpeg.length;
	});
	index.writeUInt32LE(END, frames.length * 8);
	index.writeUInt32LE(offset, frames.length * 8 + 4);
	return Buffer.concat([header, index, ...frames.map((f) => f.jpeg)]);
}
