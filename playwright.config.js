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
    // SwiftShader zodat WebGL (het diorama) ook headless werkt
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    },
  },
  webServer: {
    command: 'node scripts/dev-server.js',
    url: `http://localhost:${port}`,
    env: { PORT: String(port), GROUP_CODE: 'test', COSTS_FIXTURE: 'e2e/fixtures/costs.json', SPREADSHEET_ID: 'testsheet_abcdefghijklmnopqrstuvwxyz', RIDES_FIXTURE: 'e2e/fixtures/rides.json' },
    reuseExistingServer: !process.env.CI,
  },
});
