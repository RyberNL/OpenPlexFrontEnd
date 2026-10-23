/**
 * Writes test/fixtures/media/clip.bif: preview thumbnails of the e2e clip (one every 2 s, with
 * the clip's burned-in timecode visible), in the BIF format Plex serves from /indexes/sd.
 * Needs ffmpeg. Run: node scripts/make-bif-fixture.ts
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildBif } from '../src/lib/server/playback/bif.ts';

const INTERVAL = 2_000;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bif-'));
try {
	execFileSync('ffmpeg', [
		'-v',
		'error',
		'-i',
		'test/fixtures/media/clip.mp4',
		'-vf',
		`fps=1/${INTERVAL / 1000},scale=240:-2`,
		'-q:v',
		'5',
		path.join(dir, '%03d.jpg')
	]);
	const files = fs.readdirSync(dir).sort();
	const frames = files.map((file, i) => ({
		time: i * INTERVAL,
		jpeg: fs.readFileSync(path.join(dir, file))
	}));
	fs.writeFileSync('test/fixtures/media/clip.bif', buildBif(frames));
	console.log(`clip.bif: ${frames.length} frames`);
} finally {
	fs.rmSync(dir, { recursive: true, force: true });
}
