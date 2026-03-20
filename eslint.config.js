const sharedGlobals = {
  AbortController: "readonly",
  Blob: "readonly",
  Buffer: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  clearInterval: "readonly",
  clearTimeout: "readonly",
  console: "readonly",
  crypto: "readonly",
  fetch: "readonly",
  performance: "readonly",
  queueMicrotask: "readonly",
  setInterval: "readonly",
  setTimeout: "readonly",
  structuredClone: "readonly",
  TextDecoder: "readonly",
  TextEncoder: "readonly",
};

const browserGlobals = {
  ...sharedGlobals,
  alert: "readonly",
  caches: "readonly",
  clients: "readonly",
  confirm: "readonly",
  CustomEvent: "readonly",
  document: "readonly",
  Event: "readonly",
  EventTarget: "readonly",
  File: "readonly",
  FileReader: "readonly",
  FormData: "readonly",
  Headers: "readonly",
  history: "readonly",
  IntersectionObserver: "readonly",
  localStorage: "readonly",
  location: "readonly",
  MutationObserver: "readonly",
  navigator: "readonly",
  prompt: "readonly",
  Request: "readonly",
  ResizeObserver: "readonly",
  Response: "readonly",
  self: "readonly",
  sessionStorage: "readonly",
  window: "readonly",
};

const nodeGlobals = {
  ...sharedGlobals,
  __dirname: "readonly",
  __filename: "readonly",
  exports: "readonly",
  global: "readonly",
  module: "readonly",
  process: "readonly",
  require: "readonly",
};

const testGlobals = {
  ...nodeGlobals,
  afterAll: "readonly",
  afterEach: "readonly",
  beforeAll: "readonly",
  beforeEach: "readonly",
  describe: "readonly",
  expect: "readonly",
  test: "readonly",
  vi: "readonly",
};

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "docs/**",
      "ProofLink/**",
    ],
  },
  {
    files: ["*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: browserGlobals,
    },
    rules: {
      "no-console": "off",
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["netlify/functions/**/*.js", "scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: nodeGlobals,
    },
    rules: {
      "no-console": "off",
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["tests/**/*.js", "playwright.config.js", "vitest.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: testGlobals,
    },
    rules: {
      "no-console": "off",
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
];
