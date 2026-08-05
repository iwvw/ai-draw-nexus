# Issue Tracker: Local Markdown

Issues and PRDs for this repo live as Markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The PRD is `.scratch/<feature-slug>/PRD.md`
- Implementation issues are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is recorded as a `Status:` line near the top of each issue file
- Comments and conversation history append to the bottom of the file under `## Comments`

## Current Feature Directory

The active rewrite is tracked in:

`.scratch/kumo-sqlite-multiuser-admin/`

The canonical product document is:

`docs/prd/kumo-sqlite-multiuser-admin.md`

## When a Skill Says "Publish to the Issue Tracker"

Create or update a file under `.scratch/<feature-slug>/`. If the content is a long-lived product or process document, keep the canonical version under `docs/` and reference it from `.scratch/`.

