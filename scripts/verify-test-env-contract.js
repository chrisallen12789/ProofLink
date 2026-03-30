"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const envModule = require(path.join(repoRoot, "tests/setup/env.test.js"));

const trackedSources = [
  {
    label: ".env.test.example",
    path: path.join(repoRoot, ".env.test.example"),
    parse: parseEnvExampleKeys,
  },
  {
    label: "docs/deployment.md",
    path: path.join(repoRoot, "docs/deployment.md"),
    parse: parseMarkdownTestKeys,
  },
  {
    label: "tests/README.md",
    path: path.join(repoRoot, "tests/README.md"),
    parse: parseMarkdownTestKeys,
  },
];

function uniqueSorted(items) {
  return [...new Set(items)].sort();
}

function parseEnvExampleKeys(content) {
  return uniqueSorted(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split("=", 1)[0])
      .filter((key) => key.startsWith("TEST_"))
  );
}

function parseMarkdownTestKeys(content) {
  return uniqueSorted(content.match(/TEST_[A-Z0-9_]+/g) || []);
}

function readSourceKeys(source) {
  if (!fs.existsSync(source.path)) {
    throw new Error(`${source.label} not found at ${source.path}`);
  }
  const content = fs.readFileSync(source.path, "utf8");
  return source.parse(content);
}

function diff(reference, target) {
  return {
    missing: reference.filter((key) => !target.includes(key)),
    extra: target.filter((key) => !reference.includes(key)),
  };
}

function printDiff(label, difference) {
  if (!difference.missing.length && !difference.extra.length) return;
  if (difference.missing.length) {
    console.error(`${label} is missing keys: ${difference.missing.join(", ")}`);
  }
  if (difference.extra.length) {
    console.error(`${label} has unexpected keys: ${difference.extra.join(", ")}`);
  }
}

function main() {
  const requiredKeys = uniqueSorted(envModule.REQUIRED_ENV_KEYS || []);
  let hasMismatch = false;

  if (!requiredKeys.length) {
    throw new Error("No REQUIRED_ENV_KEYS exported from tests/setup/env.test.js");
  }

  console.log("Checking TEST_* key contract consistency...");
  console.log(`Reference: tests/setup/env.test.js (${requiredKeys.length} keys)`);

  for (const source of trackedSources) {
    const keys = readSourceKeys(source);
    const difference = diff(requiredKeys, keys);
    printDiff(source.label, difference);
    if (difference.missing.length || difference.extra.length) {
      hasMismatch = true;
      continue;
    }
    console.log(`✓ ${source.label} matches required TEST_* key contract.`);
  }

  if (hasMismatch) {
    process.exitCode = 1;
    console.error(
      "TEST_* key contract mismatch detected. Update docs/examples to match tests/setup/env.test.js."
    );
    return;
  }

  console.log("TEST_* key contract check passed.");
}

main();
