const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["*.spec.js"],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.TEST_SITE_URL || "http://127.0.0.1:8888",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
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
      testMatch: /operator-.*cross-device.*\.spec\.js/,
      use: {
        ...devices["Desktop Firefox"],
      },
    },
    {
      name: "webkit-smoke",
      testMatch: /operator-.*cross-device.*\.spec\.js/,
      use: {
        ...devices["Desktop Safari"],
      },
    },
    {
      name: "iphone-smoke",
      testMatch: /operator-.*cross-device.*\.spec\.js/,
      use: {
        ...devices["iPhone 13"],
      },
    },
    {
      name: "pixel-smoke",
      testMatch: /operator-.*cross-device.*\.spec\.js/,
      use: {
        ...devices["Pixel 7"],
      },
    },
  ],
});
