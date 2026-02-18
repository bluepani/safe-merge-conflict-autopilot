import { runShell, truncate } from "./utils.js";

function normalizeCommand(command) {
  const trimmed = String(command ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function runValidationPipeline({
  repoDir,
  formatterCommand,
  linterCommand,
  typecheckCommand,
  testCommand
}) {
  const steps = [
    { key: "formatter", command: normalizeCommand(formatterCommand) },
    { key: "linter", command: normalizeCommand(linterCommand) },
    { key: "typecheck", command: normalizeCommand(typecheckCommand) },
    { key: "tests", command: normalizeCommand(testCommand) }
  ];

  const results = [];
  for (const step of steps) {
    if (!step.command) {
      results.push({
        step: step.key,
        status: "skipped",
        code: 0,
        output: ""
      });
      continue;
    }

    const run = await runShell(step.command, { cwd: repoDir });
    results.push({
      step: step.key,
      status: run.code === 0 ? "passed" : "failed",
      code: run.code,
      output: truncate(`${run.stdout}\n${run.stderr}`.trim())
    });
  }

  const requiredRan = results.filter((item) => item.status !== "skipped");
  const passed = requiredRan.every((item) => item.status === "passed");

  return {
    passed,
    results
  };
}

