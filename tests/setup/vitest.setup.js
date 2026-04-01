"use strict";

const { assertRequiredEnv, loadTestEnv } = require("./env.test");

function isIntegrationRun() {
  return process.argv.some((arg) => arg.includes("tests/integration"));
}

beforeAll(() => {
  loadTestEnv();
  if (isIntegrationRun()) {
    assertRequiredEnv();
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
