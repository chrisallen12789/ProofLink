"use strict";

const { execSync } = require("child_process");

function parseArgs(argv) {
  const options = {
    branch: "",
    commit: "",
    repo: "",
    wait: false,
    intervalMs: 15000,
    timeoutMs: 15 * 60 * 1000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--wait") {
      options.wait = true;
      continue;
    }
    if (arg === "--branch") {
      options.branch = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }
    if (arg === "--commit") {
      options.commit = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }
    if (arg === "--repo") {
      options.repo = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }
    if (arg === "--interval-ms") {
      options.intervalMs = Math.max(Number(argv[index + 1] || 0), 1000);
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = Math.max(Number(argv[index + 1] || 0), 1000);
      index += 1;
    }
  }

  return options;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function git(command) {
  return execSync(command, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function resolveRepoSlug(explicitRepo = "") {
  if (explicitRepo) return explicitRepo;
  const remoteUrl = git("git remote get-url origin");
  const httpsMatch = remoteUrl.match(/github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/i);
  if (httpsMatch) return httpsMatch[1];
  throw new Error(`Could not resolve GitHub repo from remote URL: ${remoteUrl}`);
}

function resolveCommit(explicitCommit = "") {
  if (explicitCommit) {
    return git(`git rev-parse ${explicitCommit}`);
  }
  return git("git rev-parse HEAD");
}

function resolveBranch(explicitBranch = "") {
  if (explicitBranch) return explicitBranch;
  return git("git rev-parse --abbrev-ref HEAD");
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "ProofLink-GitHub-Status-Checker",
      Accept: "application/vnd.github+json",
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API request failed (${response.status} ${response.statusText}): ${body}`);
  }
  return response.json();
}

async function fetchRuns({ repo, branch, commit }) {
  const url = new URL(`https://api.github.com/repos/${repo}/actions/runs`);
  if (branch) url.searchParams.set("branch", branch);
  if (commit) url.searchParams.set("head_sha", commit);
  url.searchParams.set("per_page", "20");
  const payload = await fetchJson(url.toString());
  const runs = Array.isArray(payload.workflow_runs) ? payload.workflow_runs : [];
  return runs.filter((run) => !commit || String(run.head_sha || "").startsWith(commit));
}

function summarizeRuns(runs) {
  return runs.map((run) => ({
    name: run.name,
    status: run.status,
    conclusion: run.conclusion,
    url: run.html_url,
    event: run.event,
    created_at: run.created_at,
    updated_at: run.updated_at,
  }));
}

function printSummary({ repo, branch, commit, runs }) {
  console.log(`GitHub Actions status for ${repo}`);
  console.log(`Branch: ${branch}`);
  console.log(`Commit: ${commit}`);
  if (!runs.length) {
    console.log("No workflow runs found for this commit yet.");
    return;
  }
  runs.forEach((run) => {
    console.log(
      `- ${run.name}: status=${run.status} conclusion=${run.conclusion || "pending"} updated=${run.updated_at || "unknown"}`
    );
    console.log(`  ${run.url}`);
  });
}

function allRunsFinished(runs) {
  return runs.length > 0 && runs.every((run) => run.status === "completed");
}

function allRunsSuccessful(runs) {
  return runs.length > 0 && runs.every((run) => run.conclusion === "success");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repo = resolveRepoSlug(options.repo);
  const branch = resolveBranch(options.branch);
  const commit = resolveCommit(options.commit);
  const deadline = Date.now() + options.timeoutMs;

  let runs = summarizeRuns(await fetchRuns({ repo, branch, commit }));
  printSummary({ repo, branch, commit, runs });

  if (!options.wait) {
    process.exitCode = allRunsSuccessful(runs) ? 0 : 1;
    return;
  }

  while ((!runs.length || !allRunsFinished(runs)) && Date.now() < deadline) {
    await sleep(options.intervalMs);
    runs = summarizeRuns(await fetchRuns({ repo, branch, commit }));
    console.log("");
    printSummary({ repo, branch, commit, runs });
  }

  if (!allRunsFinished(runs)) {
    throw new Error(`Timed out waiting for GitHub Actions to finish for commit ${commit}.`);
  }

  if (!allRunsSuccessful(runs)) {
    throw new Error(`GitHub Actions finished with failures for commit ${commit}.`);
  }

  console.log("");
  console.log("All matching GitHub Actions runs completed successfully.");
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
