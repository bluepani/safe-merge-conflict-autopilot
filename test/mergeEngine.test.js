import test from "node:test";
import assert from "node:assert/strict";
import { resolveConflictedFile } from "../src/mergeEngine.js";

test("resolves import-only conflicts via union", async () => {
  const conflicted = [
    "<<<<<<< ours",
    "import a from 'a';",
    "import c from 'c';",
    "=======",
    "import b from 'b';",
    "import c from 'c';",
    ">>>>>>> theirs",
    ""
  ].join("\n");

  const result = await resolveConflictedFile({
    filePath: "src/file.js",
    conflictedContent: conflicted,
    baseContent: "",
    oursContent: "",
    theirsContent: "",
    aiResolveBlock: null
  });

  assert.equal(result.unresolvedBlocks, 0);
  assert.match(result.resolvedContent, /import a from 'a';/);
  assert.match(result.resolvedContent, /import b from 'b';/);
});

test("merges json files deterministically", async () => {
  const base = JSON.stringify({ name: "app", version: 1, scripts: { test: "vitest" } }, null, 2);
  const ours = JSON.stringify(
    { name: "app", version: 2, scripts: { test: "vitest", lint: "eslint ." } },
    null,
    2
  );
  const theirs = JSON.stringify({ name: "app", version: 1, scripts: { test: "vitest --run" } }, null, 2);
  const conflicted = "<<<<<<< ours\n{}\n=======\n{}\n>>>>>>> theirs\n";

  const result = await resolveConflictedFile({
    filePath: "package.json",
    conflictedContent: conflicted,
    baseContent: base,
    oursContent: ours,
    theirsContent: theirs,
    aiResolveBlock: null
  });

  assert.equal(result.unresolvedBlocks, 0);
  assert.match(result.resolvedContent, /"version": 2/);
  assert.match(result.resolvedContent, /"test": "vitest --run"/);
  assert.match(result.resolvedContent, /"lint": "eslint \."/);
});

