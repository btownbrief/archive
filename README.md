# Btown Brief Archive

Complete archive of every published Btown Brief edition (btownbrief.com, Feb 2025 →),
plus the searchable archive site at **https://play.btownbrief.com/archive/**.

Site features: full-text search with jump-to-the-exact-phrase deep links (`?hl=`),
"Ask the archive" Q&A box, this-week-last-year widget, topic timelines (incl. the
Openings & Closings tracker), stats page with trivia time capsule, random edition,
and REAL-OR-FAKE badges on headlines that appear in the game.

## Layout

- `editions/YYYY-MM-DD--slug.md` — one file per edition: YAML frontmatter (title, date,
  canonical URL, description) + the full edition body converted to markdown, with all
  outbound story links preserved as `[headline](url)`.
- `data/editions.json` — index of every edition: slug, url, title, date, description,
  word count, filename. Sorted oldest → newest.
- `data/headlines.json` — story-level dataset (1,592 "Local News" headlines with
  edition URL + date), maintained by the real-or-fake game's crawler in
  `btown-games/real-or-fake` (refreshed twice weekly by its CI job).
- `scripts/build-archive.mjs` — the crawler. Re-runnable: skips editions already on
  disk, so running it after each new edition just adds the new file and refreshes the
  index. `--force` re-fetches everything.

## Refreshing

Automatic: `.github/workflows/refresh.yml` crawls new editions Tue + Sat and redeploys.
Manual:

```
node scripts/build-archive.mjs   # crawl new editions
node scripts/extract.mjs         # stories/trivia/stats
node scripts/build-site.mjs      # generate dist/
npx pagefind --site dist         # search index
```

## Turning on Claude-powered "Ask the archive" answers

The ask box ships in extractive mode (no server needed): it shows the closest
passages with citations. To upgrade it to real written answers, deploy the edge
function in `supabase/functions/ask-archive/` (instructions in the file), then set
`ASK_ENDPOINT` in `site/archive.js` to the function URL and push.
