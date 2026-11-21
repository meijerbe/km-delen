import { defineConfig, devices } from '@playwright/test';

const port = 4173;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  fullyParallel: false,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    ...devices['iPhone 13'],
    browserName: 'chromium',
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
    // Optioneel: lokaal een bestaande Chromium gebruiken
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'node scripts/dev-server.js',
    url: `http://localhost:${port}`,
    env: { PORT: String(port), GROUP_CODE: 'test' },
    reuseExistingServer: !process.env.CI,
  },
});
