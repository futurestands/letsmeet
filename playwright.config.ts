import { defineConfig, devices } from '@playwright/test';

const previewUrl =
  process.env.STAGING_PREVIEW_URL
  || 'https://letsmeet-git-phase-1-saas-foundation-futurestands-projects.vercel.app';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: previewUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: false,
  },
  projects: [
    {
      name: 'chromium-system-chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--auto-select-desktop-capture-source=Entire screen',
            '--disable-features=WebRtcHideLocalIpsWithMdns',
          ],
        },
        permissions: ['camera', 'microphone', 'notifications'],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});
