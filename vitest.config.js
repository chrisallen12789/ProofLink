const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
  test: {
    globals: true,
    environment: "node",
    fileParallelism: false,
    testTimeout: 30000,
    setupFiles: ["./tests/setup/vitest.setup.js"],
    include: ["tests/unit/**/*.test.js", "tests/integration/**/*.int.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage/unit",
      all: false,
      thresholds: {
        lines: 70,
        statements: 70,
        functions: 65,
        branches: 40,
      },
    },
  },
});
