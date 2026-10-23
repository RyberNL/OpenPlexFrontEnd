#!/usr/bin/env node
/** Renders the app icon SVG to the PNG sizes the web manifest and iOS need. */
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const icon = (padding) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
	<rect width="512" height="512" fill="#0b0d10"/>
	<g transform="translate(${padding} ${padding}) scale(${(512 - 2 * padding) / 512})">
		<path d="M176 112 L384 256 L176 400 Z" fill="#f5b31a" stroke="#f5b31a" stroke-width="40" stroke-linejoin="round"/>
	</g>
</svg>`;

const outputs = [
	{ file: 'static/icons/icon-192.png', size: 192, padding: 32 },
	{ file: 'static/icons/icon-512.png', size: 512, padding: 32 },
	// Maskable icons keep the logo inside the 80% safe zone.
	{ file: 'static/icons/maskable-512.png', size: 512, padding: 96 },
	{ file: 'static/icons/apple-touch-icon.png', size: 180, padding: 32 }
];

fs.writeFileSync('static/icons/icon.svg', icon(32));
const browser = await chromium.launch();
const page = await browser.newPage();
for (const { file, size, padding } of outputs) {
	await page.setViewportSize({ width: size, height: size });
	await page.setContent(
		`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${icon(padding)}`
	);
	await page.screenshot({ path: file, omitBackground: false });
	console.log(`wrote ${file}`);
}
await browser.close();
