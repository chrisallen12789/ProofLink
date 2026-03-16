const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup/vitest.setup.js"],
    include: ["tests/unit/**/*.test.js", "tests/integration/**/*.int.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
