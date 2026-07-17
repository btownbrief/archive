# Btown Brief Archive — agent instructions

Shared brain for any AI agent working in this repo (Codex, Claude Code, etc.).
Read `README.md` first — it documents the layout and the build pipeline. This file
adds the rules an agent needs. Stephen is non-technical — explain consequential
changes in plain language.

## What this is
The complete archive of every Btown Brief edition plus the searchable archive site
(https://play.btownbrief.com/archive/). Content is generated from source files by a
scripted pipeline; the deployed site is built, not hand-authored.

## Layout & pipeline (don't skip steps)
- `editions/YYYY-MM-DD--slug.md` — **canonical source**, one file per edition (YAML
  frontmatter + markdown body, outbound links preserved). This is the real data.
- `data/editions.json` — index built from `editions/`. Generated.
- `data/headlines.json` — story-level dataset **maintained by the `real-or-fake` repo's
  crawler**, not here. Don't hand-edit it; if its shape looks wrong, fix it in
  `btownbrief/real-or-fake`.
- Full rebuild: `node scripts/build-archive.mjs` (crawl new editions — re-runnable,
  skips existing, `--force` re-fetches) → `node scripts/extract.mjs` → 
  `node scripts/build-site.mjs` → `npx pagefind --site dist`. Run the whole chain if you
  change extraction or templates, or search/links go stale.
- Automatic refresh: `.github/workflows/refresh.yml` crawls new editions Tue + Sat and
  redeploys.

## "Ask the archive" edge function (runtime AI — leave on Claude)
`supabase/functions/ask-archive/index.ts` is an optional Supabase edge function that
turns the ask box from extractive mode into written answers. It calls the Anthropic
API (`model: claude-sonnet-5`) with the top retrieved passages as context, keyed by a
Supabase secret (`supabase secrets set ANTHROPIC_API_KEY=...`). The site works without
it (extractive fallback). This is runtime answering, independent of which coding
assistant edits the repo — don't switch providers unless Stephen asks.

## Before you finish
No test suite. If you touched the pipeline, run the relevant build step(s) and confirm
`dist/` generates and the search index builds. Say what you verified.
