# Agent Instructions

These instructions apply to the whole repository.

## Task Routing

- Prefer the cheapest available model, subagent, or execution path for deterministic work: `build`, `test`, `lint`, `format`, log review, file listing, diff inspection, and other mechanical checks.
- Reserve the strongest model for ambiguous requirements, design decisions, debugging, root-cause analysis, and final judgment.
- If delegation is unavailable, run the mechanical step directly, but keep the path short and procedural.

## Codex CLI

- When running shell commands in this workspace, prefix them with `rtk` unless you have a specific reason not to.

## Work Style

- Inspect relevant files before editing.
- Preserve user changes and do not revert unrelated work.
- Prefer small, targeted edits and verify the result when the change affects runtime behavior.
