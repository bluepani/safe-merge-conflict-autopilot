import { parseConflictFile, renderResolvedSegments } from "./conflictParser.js";
import { tryThreeWayConfigMerge } from "./configMerge.js";
import { collapseWhitespace, normalizeWhitespace } from "./utils.js";

function nonEmptyTrimmed(lines) {
  return lines.map((line) => line.trim()).filter(Boolean);
}

function isImportLike(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return true;
  }
  return (
    /^import\s+/.test(trimmed) ||
    /^from\s+\S+\s+import\s+/.test(trimmed) ||
    /^const\s+\w+\s*=\s*require\(.+\)/.test(trimmed) ||
    /^require\(.+\)/.test(trimmed)
  );
}

function isImportBlock(lines) {
  return lines.length > 0 && lines.every((line) => isImportLike(line));
}

function uniqueLines(oursLines, theirsLines) {
  const out = [];
  const seen = new Set();
  for (const line of [...oursLines, ...theirsLines]) {
    const key = line.trim();
    if (!key) {
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(line);
  }
  return out;
}

function resolveDeterministically(block) {
  const oursText = block.oursLines.join("\n");
  const theirsText = block.theirsLines.join("\n");

  if (normalizeWhitespace(oursText) === normalizeWhitespace(theirsText)) {
    return {
      lines: block.oursLines,
      confidence: 0.99,
      method: "equivalent-whitespace",
      reason: "Both sides are semantically equal after whitespace normalization."
    };
  }

  if (nonEmptyTrimmed(block.oursLines).length === 0 && nonEmptyTrimmed(block.theirsLines).length > 0) {
    return {
      lines: block.theirsLines,
      confidence: 0.95,
      method: "pick-non-empty-theirs",
      reason: "Ours was empty while theirs contained additive changes."
    };
  }

  if (nonEmptyTrimmed(block.theirsLines).length === 0 && nonEmptyTrimmed(block.oursLines).length > 0) {
    return {
      lines: block.oursLines,
      confidence: 0.95,
      method: "pick-non-empty-ours",
      reason: "Theirs was empty while ours contained additive changes."
    };
  }

  if (isImportBlock(block.oursLines) && isImportBlock(block.theirsLines)) {
    return {
      lines: uniqueLines(block.oursLines, block.theirsLines).sort(),
      confidence: 0.9,
      method: "import-union",
      reason: "Resolved import-only conflict using deterministic union."
    };
  }

  const oursSet = new Set(nonEmptyTrimmed(block.oursLines));
  const theirsSet = new Set(nonEmptyTrimmed(block.theirsLines));
  const overlap = [...oursSet].filter((line) => theirsSet.has(line));
  if (overlap.length === 0 && oursSet.size > 0 && theirsSet.size > 0) {
    return {
      lines: uniqueLines(block.oursLines, block.theirsLines),
      confidence: 0.76,
      method: "non-overlap-union",
      reason: "No overlapping logical lines were detected across both sides."
    };
  }

  if (collapseWhitespace(oursText) === collapseWhitespace(theirsText)) {
    return {
      lines: block.oursLines,
      confidence: 0.88,
      method: "formatting-only",
      reason: "Differences were formatting-only after whitespace collapse."
    };
  }

  return null;
}

export async function resolveConflictedFile({
  filePath,
  conflictedContent,
  baseContent,
  oursContent,
  theirsContent,
  aiResolveBlock
}) {
  const configMerged = tryThreeWayConfigMerge({
    filePath,
    baseContent,
    oursContent,
    theirsContent
  });

  if (configMerged) {
    return {
      resolvedContent: configMerged.resolvedContent,
      unresolvedBlocks: 0,
      conflictCount: 1,
      confidence: configMerged.confidence,
      blockResults: [
        {
          blockId: 1,
          method: configMerged.method,
          confidence: configMerged.confidence,
          reason: "Resolved via deterministic three-way configuration merge."
        }
      ]
    };
  }

  const parsed = parseConflictFile(conflictedContent);
  const resolvedSegments = [];
  const blockResults = [];
  let unresolvedBlocks = 0;

  for (const segment of parsed.segments) {
    if (segment.type !== "conflict") {
      resolvedSegments.push(segment);
      continue;
    }

    let resolution = resolveDeterministically(segment);

    if (!resolution && aiResolveBlock) {
      resolution = await aiResolveBlock({
        filePath,
        block: segment
      });
      if (resolution) {
        resolution.method = resolution.method ?? "ai-fallback";
      }
    }

    if (!resolution) {
      unresolvedBlocks += 1;
      blockResults.push({
        blockId: segment.id,
        method: "unresolved",
        confidence: 0,
        reason: "No deterministic strategy matched and AI fallback was unavailable or declined."
      });
      resolvedSegments.push(segment);
      continue;
    }

    resolvedSegments.push({
      type: "resolved",
      lines: resolution.lines
    });
    blockResults.push({
      blockId: segment.id,
      method: resolution.method,
      confidence: resolution.confidence,
      reason: resolution.reason
    });
  }

  const meanConfidence =
    blockResults.length === 0
      ? 1
      : blockResults.reduce((sum, item) => sum + item.confidence, 0) / blockResults.length;
  const unresolvedPenalty = unresolvedBlocks > 0 ? Math.max(0, 1 - unresolvedBlocks * 0.2) : 1;

  return {
    resolvedContent: renderResolvedSegments(resolvedSegments, parsed.trailingNewline),
    unresolvedBlocks,
    conflictCount: parsed.conflicts.length,
    confidence: meanConfidence * unresolvedPenalty,
    blockResults
  };
}

