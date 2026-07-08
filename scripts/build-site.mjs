#!/usr/bin/env node
// Generates the static archive site into dist/.
//   dist/index.html            — search + ask + this-week-last-year + browse
//   dist/e/<slug>/             — one page per edition (pagefind indexes these)
//   dist/topics/<topic>/       — story timelines per topic (+ openings-closings)
//   dist/stats/                — corpus stats + trivia time capsule
// After this, run:  npx pagefind --site dist
// Usage: node scripts/build-site.mjs

import { readFileSync, readdirSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const editionsIdx = JSON.parse(readFileSync(join(ROOT, 'data', 'editions.json'), 'utf8'));
const stories = JSON.parse(readFileSync(join(ROOT, 'data', 'stories.json'), 'utf8'));
const trivia = JSON.parse(readFileSync(join(ROOT, 'data', 'trivia.json'), 'utf8'));
const stats = JSON.parse(readFileSync(join(ROOT, 'data', 'stats.json'), 'utf8'));
const gameHeadlines = new Set(
  JSON.parse(readFileSync(join(ROOT, 'data', 'headlines.json'), 'utf8'))
    .map((h) => h.headline.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()),
);

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtDate = (d) => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';
const shortDate = (d) => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';

const TOPIC_LABELS = {
  'housing': '🏘️ Housing & Development', 'downtown': '🏙️ Downtown & Neighborhoods',
  'uvm-colleges': '🎓 UVM & Colleges', 'lake-outdoors': '🌊 Lake & Outdoors',
  'weather': '🌨️ Weather & Climate', 'food-drink': '🍕 Food & Drink',
  'arts-music': '🎸 Arts & Music', 'politics': '🏛️ Politics & City Hall',
  'transportation': '🚌 Transportation', 'public-safety': '🚨 Public Safety',
  'business': '💼 Business', 'sports': '🏒 Sports',
};

// ---------- tiny markdown renderer for our edition subset ----------
function mdToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let inList = false;
  const inline = (s) => {
    s = esc(s);
    // linked image: [![](src)](href)
    s = s.replace(/\[!\[[^\]]*\]\((https?:[^)\s]+)\)\]\((https?:[^)\s]+)\)/g,
      (_, src, href) => `<a href="${href}" target="_blank" rel="noopener"><img loading="lazy" src="${src}" alt=""></a>`);
    s = s.replace(/!\[[^\]]*\]\((https?:[^)\s]+)\)/g, (_, src) => `<img loading="lazy" src="${src}" alt="">`);
    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1<em>$2</em>');
    return s;
  };
  for (const raw of lines) {
    const line = raw.trim();
    const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
    if (!line || line === '-') { closeList(); continue; }
    let m;
    if ((m = line.match(/^!\[[^\]]*\]\((https?:[^)\s]+)\)$/))) { closeList(); out.push(`<img loading="lazy" src="${esc(m[1])}" alt="">`); continue; }
    if ((m = line.match(/^(#{1,4}) (.+)$/))) { closeList(); const n = Math.min(m[1].length + 1, 5); out.push(`<h${n}>${inline(m[2])}</h${n}>`); continue; }
    if (line === '---') { closeList(); out.push('<hr>'); continue; }
    if (line === '❝') { closeList(); out.push('<div class="qmark">❝</div>'); continue; }
    if (line.startsWith('- ')) { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inline(line.slice(2))}</li>`); continue; }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

// ---------- shared shell ----------
function page({ rel, title, desc, body, index = false, extraHead = '' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📰</text></svg>">
<link rel="stylesheet" href="${rel}style.css">
${extraHead}
</head>
<body>
<header class="nav" data-pagefind-ignore>
  <a class="brand" href="${rel}index.html">📰 <span>Btown Brief <em>Archive</em></span></a>
  <nav>
    <a href="${rel}index.html">Search</a>
    <a href="${rel}topics/index.html">Topics</a>
    <a href="${rel}stats/index.html">Stats</a>
    <a href="#" id="btn-random" data-rel="${rel}">🎲 Random</a>
    <a href="https://www.btownbrief.com" target="_blank" rel="noopener">btownbrief.com ↗</a>
  </nav>
</header>
<main class="${index ? 'home' : 'inner'}">
${body}
</main>
<footer data-pagefind-ignore>
  <p>A <a href="https://play.btownbrief.com" target="_blank" rel="noopener">Btown Games</a> production ·
  <a href="https://www.btownbrief.com" target="_blank" rel="noopener">Read the Btown Brief →</a></p>
  <p class="fine">Every edition since February 2025, archived and searchable.</p>
</footer>
<script type="module" src="${rel}archive.js"></script>
</body>
</html>`;
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, 'data'), { recursive: true });

// ---------- edition pages ----------
const bySlug = new Map(editionsIdx.map((e) => [e.slug, e]));
const ordered = [...editionsIdx].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

for (let i = 0; i < ordered.length; i++) {
  const e = ordered[i];
  const raw = readFileSync(join(ROOT, 'editions', e.file), 'utf8');
  const body = raw.split('\n---\n').slice(1).join('\n---\n');
  const prev = ordered[i - 1], next = ordered[i + 1];
  const html = page({
    rel: '../../', index: false,
    title: `${e.title} — Btown Brief Archive`,
    desc: e.description || `Btown Brief edition from ${fmtDate(e.date)}`,
    body: `
<article class="edition" data-pagefind-body>
  <div class="ed-head" data-pagefind-ignore>
    <p class="crumb"><a href="../../index.html">← Archive</a></p>
    <h1 data-pagefind-meta="title">${esc(e.title)}</h1>
    <p class="ed-meta"><span data-pagefind-meta="date">${fmtDate(e.date)}</span> · ${e.words.toLocaleString()} words ·
      <a href="${e.url}" target="_blank" rel="noopener">Read on btownbrief.com ↗</a></p>
  </div>
  <div class="ed-body">${mdToHtml(body)}</div>
  <nav class="ed-nav" data-pagefind-ignore>
    ${prev ? `<a href="../${prev.slug}/index.html">← ${esc(prev.title)}</a>` : '<span></span>'}
    ${next ? `<a href="../${next.slug}/index.html">${esc(next.title)} →</a>` : '<span></span>'}
  </nav>
</article>`,
  });
  mkdirSync(join(DIST, 'e', e.slug), { recursive: true });
  writeFileSync(join(DIST, 'e', e.slug, 'index.html'), html);
}

// ---------- home ----------
const months = {};
for (const e of ordered) {
  const k = (e.date || '').slice(0, 7);
  (months[k] ||= []).push(e);
}
const monthName = (k) => new Date(k + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const browse = Object.keys(months).sort().reverse().map((k) => `
  <details class="month"${k === Object.keys(months).sort().reverse()[0] ? ' open' : ''}>
    <summary>${monthName(k)} <span class="count">${months[k].length}</span></summary>
    <ul>${months[k].map((e) => `<li><a href="e/${e.slug}/index.html">${esc(e.title)}</a> <span class="dt">${shortDate(e.date)}</span></li>`).join('')}</ul>
  </details>`).join('\n');

const topicChips = Object.entries(TOPIC_LABELS)
  .map(([t, l]) => `<a class="chip" href="topics/${t}/index.html">${l}</a>`).join('\n') +
  `\n<a class="chip chip-special" href="topics/openings-closings/index.html">🚪 Openings &amp; Closings</a>`;

const home = page({
  rel: '', index: true,
  title: 'Btown Brief Archive — every edition, searchable',
  desc: `Search all ${stats.editions} editions of the Btown Brief — Burlington VT's feel-good newsletter. ${stats.totalWords.toLocaleString()} words of local news since Feb 2025.`,
  body: `
<section class="hero">
  <h1>The Btown Brief <em>Archive</em></h1>
  <p class="tagline">Every edition since February 2025 — ${stats.editions} newsletters, ${stats.stories.toLocaleString()} stories, ${stats.totalWords.toLocaleString()} words. All searchable.</p>
</section>

<section class="panel search-panel">
  <h2>🔍 Search the archive</h2>
  <p class="hint">Remember a phrase from an edition? Type it — results jump straight to the spot.</p>
  <input id="search-box" type="search" placeholder="pancake ice, Church Street toy store, creemee…" autocomplete="off">
  <div id="search-results" aria-live="polite"></div>
</section>

<section class="panel ask-panel">
  <h2>💬 Ask the archive</h2>
  <p class="hint">Ask a question — get the closest passages the Brief has published, with sources.</p>
  <form id="ask-form"><input id="ask-box" type="text" placeholder="When did the toy store on Church Street close?" autocomplete="off">
  <button type="submit">Ask</button></form>
  <div id="ask-results" aria-live="polite"></div>
</section>

<section class="panel otd-panel" id="otd" hidden>
  <h2>🗓️ This week, last year</h2>
  <div id="otd-body"></div>
</section>

<section class="panel">
  <h2>🏷️ Browse by topic</h2>
  <div class="chips">${topicChips}</div>
</section>

<section class="panel stats-teaser">
  <h2>📊 The Brief, by the numbers</h2>
  <div class="statgrid">
    <div class="stat"><b>${stats.totalWords.toLocaleString()}</b><span>words written<br>(War and Peace ×${(stats.totalWords / 587287).toFixed(1)})</span></div>
    <div class="stat"><b>${stats.stories.toLocaleString()}</b><span>local stories covered</span></div>
    <div class="stat"><b>${stats.openings}</b><span>openings celebrated</span></div>
    <div class="stat"><b>${stats.closings}</b><span>goodbyes said</span></div>
  </div>
  <p class="teaser-cta"><a class="chip chip-special" href="stats/index.html">See all the stats — places, topics, trivia time capsule →</a></p>
</section>

<section class="panel">
  <h2>📚 Browse every edition</h2>
  ${browse}
</section>`,
  extraHead: '',
});
writeFileSync(join(DIST, 'index.html'), home);

// ---------- topic pages ----------
const topicIndexBody = ['<h1>Topics</h1><div class="chips big">'];
for (const [t, label] of Object.entries(TOPIC_LABELS)) {
  const list = stories.filter((s) => s.topics.includes(t)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  topicIndexBody.push(`<a class="chip" href="${t}/index.html">${label} <span class="count">${list.length}</span></a>`);
  const items = list.map((s) => storyCard(s, '../../')).join('\n');
  const html = page({
    rel: '../../', title: `${label.replace(/^\S+ /, '')} — Btown Brief Archive`,
    desc: `Every ${label.replace(/^\S+ /, '')} story the Btown Brief has covered.`,
    body: `<p class="crumb"><a href="../index.html">← Topics</a></p><h1>${label}</h1><p class="tagline">${list.length} stories, newest first.</p>${items}`,
  });
  mkdirSync(join(DIST, 'topics', t), { recursive: true });
  writeFileSync(join(DIST, 'topics', t, 'index.html'), html);
}
topicIndexBody.push(`<a class="chip chip-special" href="openings-closings/index.html">🚪 Openings &amp; Closings <span class="count">${stats.openings + stats.closings}</span></a></div>`);
writeFileSync(join(DIST, 'topics', 'index.html'), page({ rel: '../', title: 'Topics — Btown Brief Archive', desc: 'Browse Btown Brief stories by topic.', body: topicIndexBody.join('\n') }));

// openings & closings tracker
const oc = stories.filter((s) => s.openClose).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
writeFileSync(join(DIST, 'topics', 'openings-closings', 'index.html'), (() => {
  mkdirSync(join(DIST, 'topics', 'openings-closings'), { recursive: true });
  return page({
    rel: '../../', title: 'Openings & Closings — Btown Brief Archive',
    desc: 'Every business opening and closing the Btown Brief has covered.',
    body: `<p class="crumb"><a href="../index.html">← Topics</a></p><h1>🚪 Openings &amp; Closings</h1>
<p class="tagline">What's arrived and what we've said goodbye to — ${stats.openings} openings, ${stats.closings} closings.</p>
${oc.map((s) => storyCard(s, '../../', true)).join('\n')}`,
  });
})());

function storyCard(s, rel, badge = false) {
  const ed = bySlug.get(s.edition);
  return `<div class="story">
  ${badge && s.openClose ? `<span class="oc oc-${s.openClose}">${s.openClose === 'opening' ? 'OPENED' : 'CLOSED'}</span>` : ''}
  <h3><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.headline)}</a></h3>
  ${s.commentary ? `<p class="commentary">${esc(s.commentary.length > 300 ? s.commentary.slice(0, 297) + '…' : s.commentary)}</p>` : ''}
  <p class="story-meta">${shortDate(s.date)} · <a href="${rel}e/${s.edition}/index.html">from “${esc(ed?.title || s.edition)}”</a></p>
</div>`;
}

// ---------- stats page ----------
const monthRows = stats.monthly.map(([k, m]) =>
  `<tr><td>${monthName(k)}</td><td>${m.editions} editions</td><td>${m.words.toLocaleString()}</td></tr>`).join('');
const placeRows = stats.topPlaces.map(([p, n]) => `<tr><td>${esc(p)}</td><td>${n.toLocaleString()}</td></tr>`).join('');
const topicRows = Object.entries(stats.topicCounts).sort((a, b) => b[1] - a[1])
  .map(([t, n]) => `<tr><td><a href="../topics/${t}/index.html">${TOPIC_LABELS[t]}</a></td><td>${n}</td></tr>`).join('');
const warAndPeace = (stats.totalWords / 587287).toFixed(1);
const triviaCards = trivia.map((t) => `<div class="trivia" hidden>
<p class="tq">${esc(t.question)} <span class="dt">${shortDate(t.date)}</span></p>
${t.options?.length ? `<ul>${t.options.map((o, i) => `<li>${'ABCD'[i]}) ${esc(o)}</li>`).join('')}</ul>` : ''}
<button class="reveal-btn" type="button">Reveal answer</button>
<p class="tanswer" hidden><strong>Answer:</strong> ${esc(t.answer || 'Lost to history — check the edition!')} · <a href="../e/${t.edition}/index.html">edition</a></p>
</div>`).join('\n');

mkdirSync(join(DIST, 'stats'), { recursive: true });
writeFileSync(join(DIST, 'stats', 'index.html'), page({
  rel: '../', title: 'Stats — Btown Brief Archive', desc: 'Btown Brief by the numbers.',
  body: `<h1>📊 The Brief, by the numbers</h1>
<div class="statgrid">
  <div class="stat"><b>${stats.editions}</b><span>editions</span></div>
  <div class="stat"><b>${stats.totalWords.toLocaleString()}</b><span>words written<br>(War and Peace ×${warAndPeace})</span></div>
  <div class="stat"><b>${stats.stories.toLocaleString()}</b><span>local stories covered</span></div>
  <div class="stat"><b>${stats.avgWords.toLocaleString()}</b><span>words per edition</span></div>
  <div class="stat"><b>${stats.openings}</b><span>openings celebrated</span></div>
  <div class="stat"><b>${stats.closings}</b><span>goodbyes said</span></div>
</div>
<p class="tagline">Longest edition ever: <a href="../e/${stats.longest.slug}/index.html">${esc(stats.longest.title)}</a> at ${stats.longest.words.toLocaleString()} words.</p>
<div class="cols">
<section><h2>Most-mentioned places</h2><table>${placeRows}</table></section>
<section><h2>Stories by topic</h2><table>${topicRows}</table></section>
</div>
<section><h2>Month by month</h2><table>${monthRows}</table></section>
<section><h2>🧠 Trivia time capsule</h2><p class="hint">From the early editions, when trivia lived in the newsletter itself. A fresh few every visit — <button class="reveal-btn" id="trivia-shuffle" type="button">shuffle 🔀</button></p>
<div id="trivia-deck">${triviaCards}</div></section>`,
}));

// ---------- client data + assets ----------
const storiesLite = stories.map((s) => ({
  h: s.headline, u: s.url, e: s.edition, d: s.date,
  g: gameHeadlines.has(s.headline.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()) ? 1 : 0,
}));
writeFileSync(join(DIST, 'data', 'editions.json'), JSON.stringify(editionsIdx.map(({ slug, url, title, date }) => ({ slug, url, title, date }))));
writeFileSync(join(DIST, 'data', 'stories-lite.json'), JSON.stringify(storiesLite));
cpSync(join(ROOT, 'site', 'style.css'), join(DIST, 'style.css'));
cpSync(join(ROOT, 'site', 'archive.js'), join(DIST, 'archive.js'));

console.log(`Built ${ordered.length} edition pages, ${Object.keys(TOPIC_LABELS).length + 1} topic pages, stats, home → dist/`);
