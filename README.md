MAIN VERSION

# Zero-Friction Safe Git Merge Conflict Autopilot

some change test ding dong

A GitHub-native merge conflict resolver focused on safety, determinism, and low developer friction.

## What It Does

- Detects merge conflicts for pull requests by performing a synthetic merge (`PR head` + `base branch`).
- Resolves conflicts with deterministic logic first:
  - import union for import-only blocks
  - formatting-only equivalence
  - additive non-overlapping unions
  - three-way JSON merge
  - three-way flat YAML merge
- Uses AI only as a fallback when enabled.
- Runs validation gates after resolution:
  - formatter
  - linter
  - typecheck/build
  - tests
- Computes a confidence score and auto-applies only if:
  - no unresolved conflict blocks remain
  - validation passes
  - confidence exceeds threshold
- Posts a PR comment summarizing changes, validation results, and confidence.

## Safety Model

- Deterministic-first merge engine.
- AI fallback is opt-in (`enable-ai`).
- Auto-apply is confidence-gated and validation-gated.
- Fork PRs are not auto-pushed by default (comment-only behavior).

## Usage

Use the included workflow:

```yaml
name: Merge Conflict Autopilot

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: write
  pull-requests: write

jobs:
  safe-conflict-autopilot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          auto-apply: "true"
          confidence-threshold: "0.85"
          formatter-command: "npm run format --if-present"
          linter-command: "npm run lint --if-present"
          typecheck-command: "npm run typecheck --if-present"
          test-command: "npm test --if-present"
          enable-ai: "false"
```

## Inputs

- `github-token` (required)
- `auto-apply` (default: `true`)
- `confidence-threshold` (default: `0.85`)
- `formatter-command`
- `linter-command`
- `typecheck-command`
- `test-command`
- `enable-ai` (default: `false`)
- `openai-api-key` (required only when `enable-ai=true`)
- `ai-model` (default: `gpt-4.1-mini`)

## Local Tests

```bash
npm test
```

## Current Limits

- AST-level semantic merging is currently heuristic-oriented and language-agnostic.
- YAML deterministic merging currently supports flat key-value maps only.
- Suggested partial resolutions are summarized in PR comments; patch suggestion comments can be added next.
