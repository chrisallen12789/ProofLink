const os = require('os');
const path = require('path');
const { defineConfig, devices } = require("@playwright/test");

const captureFailureArtifacts = process.env.PLAYWRIGHT_CAPTURE_FAILURE_ARTIFACTS === "1";
const playwrightOutputDir = process.env.PLAYWRIGHT_OUTPUT_DIR || path.join(os.tmpdir(), 'prooflink-playwright-results');

module.exports = defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["*.spec.js"],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  outputDir: playwrightOutputDir,
  use: {
    baseURL: process.env.TEST_SITE_URL || "http://127.0.0.1:8888",
    actionTimeout: 15000,
    navigationTimeout: 60000,
    trace: captureFailureArtifacts ? "retain-on-failure" : "off",
    screenshot: captureFailureArtifacts ? "only-on-failure" : "off",
    video: captureFailureArtifacts ? "retain-on-failure" : "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
    {
      name: "firefox-smoke",
      testMatch: /(operator|crew)-.*cross-device.*\.spec\.js/,
      use: {
        ...devices["Desktop Firefox"],
      },
    },
    {
      name: "webkit-smoke",
      testMatch: /(operator|crew)-.*cross-device.*\.spec\.js/,
      use: {
        ...devices["Desktop Safari"],
      },
    },
    {
      name: "iphone-smoke",
      testMatch: /(operator|crew)-.*cross-device.*\.spec\.js/,
      use: {
        ...devices["iPhone 13"],
      },
    },
    {
      name: "pixel-smoke",
      testMatch: /(operator|crew)-.*cross-device.*\.spec\.js/,
      use: {
        ...devices["Pixel 7"],
      },
    },
  ],
});
