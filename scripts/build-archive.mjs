#!/usr/bin/env node
// Btown Brief full-edition archive builder.
//
// Crawls every edition in the sitemap and writes:
//   editions/YYYY-MM-DD--slug.md   (frontmatter + full edition as markdown)
//   data/editions.json             (index: slug, url, title, date, description, words)
// Polite: one fetch at a time with a delay. Re-runnable: skips editions
// already on disk unless --force.  Usage: node scripts/build-archive.mjs
//
// No dependencies — plain Node 18+.

import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITEMAP = 'https://www.btownbrief.com/sitemap.xml';
const DELAY_MS = 700;
const FORCE = process.argv.includes('--force');
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'accept': 'text/html,application/xhtml+xml',
  'accept-language': 'en-US,en;q=0.9',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const decodeEntities = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

// Extract the balanced <div id="content-blocks"> ... </div> region.
function contentRegion(html) {
  const at = html.indexOf('id="content-blocks"');
  if (at === -1) return null;
  const open = html.lastIndexOf('<div', at);
  let depth = 0, i = open;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = open;
  for (let m; (m = re.exec(html)); ) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(open, m.index + 6);
  }
  return html.slice(open);
}

// Minimal HTML -> markdown for beehiiv post content.
function toMarkdown(html) {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  // images -> markdown images (keep CDN url so archive can show them)
  s = s.replace(/<img[^>]*src="([^"]+)"[^>]*>/gi, (_, src) => `\n![](${src})\n`);
  // links -> [text](href); drop beehiiv tracking redirects if plain
  s = s.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
    const text = decodeEntities(inner.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (!/^https?:/.test(href)) return text;
    return `[${text}](${href})`;
  });
  // headings
  s = s.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `\n\n# ${strip(t)}\n\n`)
       .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `\n\n## ${strip(t)}\n\n`)
       .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `\n\n### ${strip(t)}\n\n`)
       .replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, (_, t) => `\n\n#### ${strip(t)}\n\n`);
  // list items, paragraphs, breaks, hr
  s = s.replace(/<li\b[^>]*>/gi, '\n- ')
       .replace(/<\/(p|div|li|ul|ol|tr|table|blockquote|figure)>/gi, '\n')
       .replace(/<(p|blockquote)\b[^>]*>/gi, '\n')
       .replace(/<br\s*\/?>/gi, '\n')
       .replace(/<hr[^>]*>/gi, '\n\n---\n\n');
  // bold/italic
  s = s.replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => `**${strip(t)}**`)
       .replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => `*${strip(t)}*`);
  // everything else
  s = decodeEntities(s.replace(/<[^>]+>/g, ''));
  // tidy whitespace
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ');
  return s.trim();

  function strip(t) {
    return decodeEntities(t.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  }
}

const meta = (html, re) => (html.match(re) || [])[1] || null;

const res = await fetch(SITEMAP, { headers: HEADERS });
if (!res.ok) { console.error(`sitemap fetch failed: ${res.status}`); process.exit(1); }
const urls = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((m) => m[1]).filter((u) => u.includes('/p/'));
console.log(`${urls.length} edition URLs in sitemap`);

mkdirSync(join(ROOT, 'editions'), { recursive: true });
mkdirSync(join(ROOT, 'data'), { recursive: true });

const index = [];
const misses = [];
let n = 0;

for (const url of urls) {
  n++;
  const slug = url.split('/p/')[1].replace(/\/$/, '');
  const existing = !FORCE && readdirSync(join(ROOT, 'editions')).find((f) => f.endsWith(`--${slug}.md`));
  let title, date, description, md, file;

  if (existing) {
    const raw = readFileSync(join(ROOT, 'editions', existing), 'utf8');
    title = meta(raw, /^title: "(.*)"$/m);
    date = meta(raw, /^date: (\S+)$/m);
    description = meta(raw, /^description: "(.*)"$/m) || '';
    md = raw.split('\n---\n').slice(1).join('\n---\n');
    file = existing;
    process.stdout.write(`\r${n}/${urls.length} (cached) ${slug}          `);
  } else {
    await sleep(DELAY_MS);
    let html;
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (!r.ok) { misses.push(`${url} → HTTP ${r.status}`); continue; }
      html = await r.text();
    } catch (e) { misses.push(`${url} → ${e.message}`); continue; }

    title = decodeEntities(meta(html, /property="og:title" content="([^"]*)"/) || slug);
    date = (meta(html, /property="article:published_time" content="([^"]+)"/) || '').slice(0, 10) || null;
    description = decodeEntities(meta(html, /name="description" content="([^"]*)"/) || '');
    const region = contentRegion(html);
    if (!region) { misses.push(`${url} → no content-blocks`); continue; }
    md = toMarkdown(region);

    file = `${date || 'undated'}--${slug}.md`;
    const fm = [
      '---',
      `title: "${title.replace(/"/g, '\\"')}"`,
      `date: ${date}`,
      `url: ${url}`,
      `description: "${description.replace(/"/g, '\\"')}"`,
      '---',
      '',
    ].join('\n');
    writeFileSync(join(ROOT, 'editions', file), fm + md + '\n');
    process.stdout.write(`\r${n}/${urls.length} fetched ${slug}          `);
  }

  index.push({ slug, url, title, date, description, words: md.split(/\s+/).length, file });
}
console.log();

index.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
writeFileSync(join(ROOT, 'data', 'editions.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`Wrote ${index.length} editions to data/editions.json`);
console.log(`Date range: ${index[0]?.date} … ${index.at(-1)?.date}`);
if (misses.length) {
  console.log(`\n${misses.length} misses:`);
  for (const m of misses) console.log('  ' + m);
}
