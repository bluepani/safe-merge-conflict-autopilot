import fs from "node:fs/promises";
import path from "node:path";
import { runShell } from "./utils.js";

function quote(arg) {
  return `'${String(arg).replace(/'/g, `'\\''`)}'`;
}

async function runGit(args, { cwd, env } = {}) {
  const command = `git ${args.map((arg) => quote(arg)).join(" ")}`;
  return runShell(command, { cwd, env });
}

export async function cloneRepository({ owner, repo, token, targetDir }) {
  const remote = `https://x-access-token:${encodeURIComponent(token)}@github.com/${owner}/${repo}.git`;
  const result = await runGit(["clone", "--quiet", remote, targetDir]);
  if (result.code !== 0) {
    throw new Error(`Failed to clone repository: ${result.stderr || result.stdout}`);
  }
}

export async function checkoutPullRequest({ repoDir, pullNumber }) {
  const fetchResult = await runGit(
    ["fetch", "--quiet", "origin", `+refs/pull/${pullNumber}/head:refs/remotes/origin/pr/${pullNumber}`],
    { cwd: repoDir }
  );
  if (fetchResult.code !== 0) {
    throw new Error(`Failed to fetch pull request head: ${fetchResult.stderr || fetchResult.stdout}`);
  }

  const checkoutResult = await runGit(
    ["checkout", "--quiet", "-B", "autopilot-pr-head", `refs/remotes/origin/pr/${pullNumber}`],
    { cwd: repoDir }
  );
  if (checkoutResult.code !== 0) {
    throw new Error(`Failed to checkout pull request head: ${checkoutResult.stderr || checkoutResult.stdout}`);
  }
}

export async function fetchBaseBranch({ repoDir, baseRef }) {
  const fetchResult = await runGit(
    ["fetch", "--quiet", "origin", `+refs/heads/${baseRef}:refs/remotes/origin/base-target`],
    { cwd: repoDir }
  );
  if (fetchResult.code !== 0) {
    throw new Error(`Failed to fetch base branch: ${fetchResult.stderr || fetchResult.stdout}`);
  }
}

export async function mergeBaseIntoHead({ repoDir }) {
  const mergeResult = await runGit(
    ["merge", "--no-commit", "--no-ff", "refs/remotes/origin/base-target"],
    { cwd: repoDir }
  );
  return mergeResult;
}

export async function getConflictedFiles({ repoDir }) {
  const result = await runGit(["diff", "--name-only", "--diff-filter=U"], { cwd: repoDir });
  if (result.code !== 0) {
    throw new Error(`Failed to list conflicted files: ${result.stderr || result.stdout}`);
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function readFileUtf8({ repoDir, filePath }) {
  return fs.readFile(path.join(repoDir, filePath), "utf8");
}

export async function writeFileUtf8({ repoDir, filePath, content }) {
  await fs.writeFile(path.join(repoDir, filePath), content, "utf8");
}

export async function getConflictStageBlobs({ repoDir, filePath }) {
  const result = await runGit(["ls-files", "-u", "--", filePath], { cwd: repoDir });
  if (result.code !== 0) {
    return {};
  }
  const stages = {};
  const lines = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^\d+\s+([0-9a-f]{40})\s+(\d)\t/);
    if (!match) {
      continue;
    }
    const [, sha, stage] = match;
    stages[stage] = sha;
  }
  return stages;
}

export async function readBlobBySha({ repoDir, sha }) {
  if (!sha) {
    return "";
  }
  const result = await runGit(["show", sha], { cwd: repoDir });
  if (result.code !== 0) {
    return "";
  }
  return result.stdout;
}

export async function stageFiles({ repoDir, files }) {
  if (files.length === 0) {
    return;
  }
  const result = await runGit(["add", "--", ...files], { cwd: repoDir });
  if (result.code !== 0) {
    throw new Error(`Failed to stage files: ${result.stderr || result.stdout}`);
  }
}

export async function commitResolution({ repoDir, message }) {
  await runGit(["config", "user.name", "merge-conflict-autopilot[bot]"], { cwd: repoDir });
  await runGit(
    ["config", "user.email", "merge-conflict-autopilot[bot]@users.noreply.github.com"],
    {
      cwd: repoDir
    }
  );
  const result = await runGit(["commit", "-m", message], { cwd: repoDir });
  return result;
}

export async function pushHead({ repoDir, branchRef }) {
  const result = await runGit(["push", "origin", `HEAD:${branchRef}`], { cwd: repoDir });
  return result;
}

