import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';
const windowsEdge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
// A supplied browser takes precedence; otherwise use installed Edge or Playwright Chromium.
const executablePath = process.env.CAPMART_BROWSER_PATH || (existsSync(windowsEdge) ? windowsEdge : undefined);
export default defineConfig({
  testDir: './tests/ui', timeout: 30000, fullyParallel: false, workers: 1, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5173', launchOptions: executablePath ? { executablePath } : {}, screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'tablet', use: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
  ],
  webServer: { command: 'npm run dev -- --port 5173', url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 30000 },
});
