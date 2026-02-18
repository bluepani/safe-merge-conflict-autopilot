import { round } from "./utils.js";

export function computeConfidence({ fileResolutions, validation }) {
  const fileScore =
    fileResolutions.length === 0
      ? 1
      : fileResolutions.reduce((sum, file) => sum + file.confidence, 0) / fileResolutions.length;

  const validationSteps = validation.results.filter((step) => step.status !== "skipped");
  const validationScore =
    validationSteps.length === 0
      ? 1
      : validationSteps.filter((step) => step.status === "passed").length / validationSteps.length;

  const unresolved = fileResolutions.reduce((sum, file) => sum + file.unresolvedBlocks, 0);
  const unresolvedPenalty = unresolved === 0 ? 1 : Math.max(0, 1 - unresolved * 0.2);

  return round((fileScore * 0.7 + validationScore * 0.3) * unresolvedPenalty);
}

