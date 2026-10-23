import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
export const FAKE_PMS_PORT = 32499;
export const FAKE_PMS_URL = `http://127.0.0.1:${FAKE_PMS_PORT}`;
export const E2E_DATA_DIR = '.e2e-data';
export const E2E_SETUP_TOKEN = 'e2e-setup-token';

const mobile = { viewport: { width: 390, height: 844 }, hasTouch: true };
const desktop = { viewport: { width: 1440, height: 900 } };

export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.e2e.ts',
	fullyParallel: false,
	workers: 1,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL: `http://localhost:${PORT}`,
		// Production runs behind a TLS proxy that sets X-Forwarded-Proto; mirror that here.
		extraHTTPHeaders: { 'x-forwarded-proto': 'http' },
		trace: 'retain-on-failure'
	},
	projects: [
		// First-run setup needs an empty database, so it runs once before everything else.
		{
			name: 'setup',
			testMatch: 'setup.e2e.ts',
			use: { ...devices['Desktop Chrome'], ...desktop }
		},
		...[
			{ name: 'chromium-mobile', use: { ...devices['Desktop Chrome'], ...mobile } },
			{ name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], ...desktop } },
			// The Linux WebKit build plays media through GStreamer, whose MSE pipeline sometimes
			// accepts the fake's segments without buffering them (more often after stream switches),
			// so playback never starts. Retries keep runs green; flaky tests are still reported.
			{ name: 'webkit-mobile', retries: 2, use: { ...devices['Desktop Safari'], ...mobile } },
			{ name: 'webkit-desktop', retries: 2, use: { ...devices['Desktop Safari'], ...desktop } }
		].map((project) => ({ ...project, dependencies: ['setup'], testIgnore: 'setup.e2e.ts' }))
	],
	webServer: [
		{
			command: 'node test/fake-pms/server.ts',
			port: FAKE_PMS_PORT,
			reuseExistingServer: false,
			env: { FAKE_PMS_PORT: String(FAKE_PMS_PORT) }
		},
		{
			// E2E_PREBUILT=1 reuses an existing build (the chunked runner builds once up front).
			command: `rm -rf ${E2E_DATA_DIR} && ${process.env.E2E_PREBUILT ? '' : 'npm run build && '}node build`,
			port: PORT,
			reuseExistingServer: false,
			stdout: 'ignore',
			env: {
				PLEX_URL: FAKE_PMS_URL,
				PLEX_TV_URL: `${FAKE_PMS_URL}/plextv`,
				PORT: String(PORT),
				PUBLIC_ORIGIN: `http://localhost:${PORT}`,
				APP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
				DATA_DIR: E2E_DATA_DIR,
				SETUP_TOKEN: E2E_SETUP_TOKEN,
				AUTH_RATE_LIMIT: '100000',
				PROTOCOL_HEADER: 'x-forwarded-proto'
			}
		}
	]
});
