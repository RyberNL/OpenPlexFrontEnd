import { describe, expect, it } from 'vitest';
import { BifError, buildBif, frameIndexAt, parseBif } from './bif';

const jpeg = (label: string) => Buffer.from(`\xff\xd8${label}\xff\xd9`, 'latin1');

describe('parseBif', () => {
	const frames = [0, 10_000, 20_000, 30_000].map((time) => ({ time, jpeg: jpeg(`frame@${time}`) }));

	it('reads frame times and the bytes of each frame', () => {
		const bif = parseBif(buildBif(frames));
		expect(bif.times).toEqual([0, 10_000, 20_000, 30_000]);
		expect(bif.frame(0).toString('latin1')).toBe('\xff\xd8frame@0\xff\xd9');
		expect(bif.frame(3).toString('latin1')).toBe('\xff\xd8frame@30000\xff\xd9');
	});

	it('applies the timestamp multiplier (0 means 1000 ms)', () => {
		const data = buildBif(frames, 2000);
		expect(parseBif(data).times).toEqual([0, 10_000, 20_000, 30_000]);
		data.writeUInt32LE(0, 16);
		expect(parseBif(data).times).toEqual([0, 5_000, 10_000, 15_000]);
	});

	it('finds the frame showing at a time', () => {
		const bif = parseBif(buildBif(frames));
		expect(frameIndexAt(bif, 0)).toBe(0);
		expect(frameIndexAt(bif, 9_999)).toBe(0);
		expect(frameIndexAt(bif, 10_000)).toBe(1);
		expect(frameIndexAt(bif, 25_000)).toBe(2);
		expect(frameIndexAt(bif, 999_999)).toBe(3);
		expect(frameIndexAt(parseBif(buildBif([])), 5)).toBe(-1);
	});

	it('rejects files that are not BIF, or are truncated or inconsistent', () => {
		expect(() => parseBif(Buffer.from('not a bif file at all'))).toThrow(BifError);
		const data = buildBif(frames);
		expect(() => parseBif(data.subarray(0, 80))).toThrow(BifError);
		const noEnd = Buffer.from(data);
		noEnd.writeUInt32LE(40, 64 + 4 * 8);
		expect(() => parseBif(noEnd)).toThrow('Missing BIF index end');
		const badOffset = Buffer.from(data);
		badOffset.writeUInt32LE(data.length + 10, 64 + 8 + 4);
		expect(() => parseBif(badOffset)).toThrow('Invalid BIF frame offset');
	});
});
