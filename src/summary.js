import { round } from "./utils.js";

function statusIcon(status) {
  if (status === "passed") {
    return "✅";
  }
  if (status === "failed") {
    return "❌";
  }
  return "➖";
}

function confidencePercent(value) {
  return `${Math.round(value * 100)}%`;
}

export function buildSummaryComment({
  fileResolutions,
  validation,
  confidence,
  threshold,
  autoApplyEnabled,
  autoApplied,
  applyFailure,
  unresolvedBlocks
}) {
  const lines = [];
  lines.push("## Merge Conflict Autopilot Result");
  lines.push("");
  lines.push(`- Overall confidence: **${confidencePercent(confidence)}** (threshold: ${confidencePercent(threshold)})`);
  lines.push(`- Unresolved conflict blocks: **${unresolvedBlocks}**`);
  lines.push(
    `- Auto-apply requested: **${autoApplyEnabled ? "yes" : "no"}**, auto-applied: **${autoApplied ? "yes" : "no"}**`
  );
  if (applyFailure) {
    lines.push(`- Auto-apply error: \`${applyFailure}\``);
  }
  lines.push("");
  lines.push("### File-Level Resolution");
  lines.push("");

  if (fileResolutions.length === 0) {
    lines.push("- No conflicted files detected.");
  } else {
    for (const file of fileResolutions) {
      lines.push(
        `- \`${file.filePath}\`: ${confidencePercent(round(file.confidence))}, unresolved blocks: ${file.unresolvedBlocks}`
      );
      for (const block of file.blockResults.slice(0, 5)) {
        lines.push(
          `  - block #${block.blockId}: ${block.method}, confidence ${confidencePercent(
            round(block.confidence)
          )}`
        );
      }
      if (file.blockResults.length > 5) {
        lines.push(`  - ... ${file.blockResults.length - 5} additional blocks`);
      }
    }
  }

  lines.push("");
  lines.push("### Validation");
  lines.push("");
  for (const step of validation.results) {
    lines.push(`- ${statusIcon(step.status)} \`${step.step}\`: ${step.status}`);
  }

  lines.push("");
  if (unresolvedBlocks > 0) {
    lines.push("Manual review is required because unresolved conflict markers remain.");
  } else if (!validation.passed) {
    lines.push("Manual review is required because one or more validation gates failed.");
  } else if (!autoApplied && autoApplyEnabled && confidence < threshold) {
    lines.push("Manual review is required because confidence is below the auto-apply threshold.");
  } else if (autoApplied) {
    lines.push("Conflict resolution was committed back to the PR branch.");
  } else {
    lines.push("Resolution was generated and posted for review.");
  }

  return lines.join("\n");
}

