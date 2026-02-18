import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveConflictedFile } from "./mergeEngine.js";
import { createAIResolver } from "./aiResolver.js";
import {
  checkoutPullRequest,
  cloneRepository,
  commitResolution,
  fetchBaseBranch,
  getConflictStageBlobs,
  getConflictedFiles,
  mergeBaseIntoHead,
  pushHead,
  readBlobBySha,
  readFileUtf8,
  stageFiles,
  writeFileUtf8
} from "./git.js";
import { postPullRequestComment } from "./github.js";
import { runValidationPipeline } from "./validator.js";
import { computeConfidence } from "./confidence.js";
import { buildSummaryComment } from "./summary.js";
import { round, toBoolean, toNumber } from "./utils.js";

function getInput(name, fallback = "") {
  const key = `INPUT_${name.toUpperCase().replace(/[-\s]/g, "_")}`;
  const value = process.env[key];
  if (value == null || value === "") {
    return fallback;
  }
  return value;
}

function setOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    console.log(`${name}=${value}`);
    return;
  }
  fs.appendFileSync(outputPath, `${name}=${value}\n`, "utf8");
}

function fail(message) {
  console.error(`::error::${message}`);
  process.exitCode = 1;
}

async function run() {
  const token = getInput("github-token", process.env.GITHUB_TOKEN ?? "");
  if (!token) {
    throw new Error("Missing GitHub token. Provide input github-token.");
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) {
    throw new Error("GITHUB_EVENT_PATH is missing; this action must run within GitHub Actions.");
  }

  const event = JSON.parse(await fsPromises.readFile(eventPath, "utf8"));
  if (!event.pull_request) {
    throw new Error("This action currently supports pull_request events only.");
  }

  const owner = event.repository.owner.login;
  const repo = event.repository.name;
  const pullNumber = event.pull_request.number;
  const baseRef = event.pull_request.base.ref;
  const headRef = event.pull_request.head.ref;
  const headRepoFullName = event.pull_request.head.repo.full_name;
  const baseRepoFullName = `${owner}/${repo}`;

  const autoApply = toBoolean(getInput("auto-apply", "true"), true);
  const confidenceThreshold = toNumber(getInput("confidence-threshold", "0.85"), 0.85);
  const formatterCommand = getInput("formatter-command", "");
  const linterCommand = getInput("linter-command", "");
  const typecheckCommand = getInput("typecheck-command", "");
  const testCommand = getInput("test-command", "");

  const enableAi = toBoolean(getInput("enable-ai", "false"), false);
  const openAiApiKey = getInput("openai-api-key", "");
  const aiModel = getInput("ai-model", "gpt-4.1-mini");
  const aiResolveBlock = createAIResolver({
    enabled: enableAi,
    apiKey: openAiApiKey,
    model: aiModel
  });

  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "safe-merge-autopilot-"));
  const repoDir = path.join(tempRoot, "repo");

  console.log(`Cloning ${owner}/${repo} into temporary workspace...`);
  await cloneRepository({ owner, repo, token, targetDir: repoDir });
  await checkoutPullRequest({ repoDir, pullNumber });
  await fetchBaseBranch({ repoDir, baseRef });

  const mergeAttempt = await mergeBaseIntoHead({ repoDir });
  if (mergeAttempt.code !== 0) {
    console.log("Synthetic merge reported conflicts or merge issues; continuing with conflict analysis.");
  }

  const conflictedFiles = await getConflictedFiles({ repoDir });
  if (conflictedFiles.length === 0) {
    const message = "No merge conflicts detected in the pull request head against the current base branch.";
    await postPullRequestComment({
      token,
      owner,
      repo,
      pullNumber,
      body: `## Merge Conflict Autopilot Result\n\n${message}`
    });
    setOutput("confidence", "1");
    setOutput("auto-applied", "false");
    return;
  }

  const fileResolutions = [];
  for (const filePath of conflictedFiles) {
    const conflictedContent = await readFileUtf8({ repoDir, filePath });
    const stages = await getConflictStageBlobs({ repoDir, filePath });
    const baseContent = await readBlobBySha({ repoDir, sha: stages["1"] });
    const oursContent = await readBlobBySha({ repoDir, sha: stages["2"] });
    const theirsContent = await readBlobBySha({ repoDir, sha: stages["3"] });

    const resolved = await resolveConflictedFile({
      filePath,
      conflictedContent,
      baseContent,
      oursContent,
      theirsContent,
      aiResolveBlock
    });

    await writeFileUtf8({
      repoDir,
      filePath,
      content: resolved.resolvedContent
    });

    fileResolutions.push({
      filePath,
      unresolvedBlocks: resolved.unresolvedBlocks,
      confidence: round(resolved.confidence),
      blockResults: resolved.blockResults
    });
  }

  const validation = await runValidationPipeline({
    repoDir,
    formatterCommand,
    linterCommand,
    typecheckCommand,
    testCommand
  });

  const unresolvedBlocks = fileResolutions.reduce((sum, file) => sum + file.unresolvedBlocks, 0);
  const overallConfidence = computeConfidence({
    fileResolutions,
    validation
  });

  const shouldAutoApply =
    autoApply &&
    unresolvedBlocks === 0 &&
    validation.passed &&
    overallConfidence >= confidenceThreshold;

  let autoApplied = false;
  let applyFailure = "";

  if (shouldAutoApply) {
    try {
      await stageFiles({
        repoDir,
        files: ["."]
      });

      const commitResult = await commitResolution({
        repoDir,
        message: "chore: auto-resolve merge conflicts safely"
      });

      const commitOutput = `${commitResult.stdout}\n${commitResult.stderr}`;
      if (/nothing to commit/i.test(commitOutput)) {
        applyFailure = "Nothing changed after resolution; no commit created.";
      } else if (commitResult.code !== 0) {
        applyFailure = commitOutput.trim() || "Commit command failed.";
      } else if (headRepoFullName !== baseRepoFullName) {
        applyFailure = "PR originates from a fork; skipping push for safety/permissions.";
      } else {
        const pushResult = await pushHead({ repoDir, branchRef: headRef });
        if (pushResult.code !== 0) {
          applyFailure = `${pushResult.stdout}\n${pushResult.stderr}`.trim() || "Push failed.";
        } else {
          autoApplied = true;
        }
      }
    } catch (error) {
      applyFailure = error instanceof Error ? error.message : String(error);
    }
  }

  const summary = buildSummaryComment({
    fileResolutions,
    validation,
    confidence: overallConfidence,
    threshold: confidenceThreshold,
    autoApplyEnabled: autoApply,
    autoApplied,
    applyFailure,
    unresolvedBlocks
  });

  await postPullRequestComment({
    token,
    owner,
    repo,
    pullNumber,
    body: summary
  });

  setOutput("confidence", String(overallConfidence));
  setOutput("auto-applied", String(autoApplied));
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(message);
});
