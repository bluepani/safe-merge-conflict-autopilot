import test from "node:test";
import assert from "node:assert/strict";
import { parseConflictFile, renderResolvedSegments } from "../src/conflictParser.js";

test("parseConflictFile finds single conflict", () => {
  const content = [
    "const a = 1;",
    "<<<<<<< ours",
    "const b = 2;",
    "=======",
    "const b = 3;",
    ">>>>>>> theirs",
    "export { a, b };",
    ""
  ].join("\n");

  const parsed = parseConflictFile(content);
  assert.equal(parsed.conflicts.length, 1);
  assert.equal(parsed.conflicts[0].oursLines[0], "const b = 2;");
  assert.equal(parsed.conflicts[0].theirsLines[0], "const b = 3;");
});

test("renderResolvedSegments keeps trailing newline", () => {
  const parsed = parseConflictFile("a\n<<<<<<< ours\nx\n=======\ny\n>>>>>>> theirs\nz\n");
  const segments = parsed.segments.map((segment) =>
    segment.type === "conflict"
      ? {
          type: "resolved",
          lines: ["x", "y"]
        }
      : segment
  );
  const rendered = renderResolvedSegments(segments, true);
  assert.equal(rendered, "a\nx\ny\nz\n");
});

