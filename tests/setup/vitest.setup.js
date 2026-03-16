"use strict";

const { loadTestEnv } = require("./env.test");

beforeAll(() => {
  loadTestEnv();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
