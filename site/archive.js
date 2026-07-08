// Btown Brief Archive — client behaviors: search, ask, this-week-last-year, random.
// Root-relative paths are derived from this module's own URL so pages at any
// depth (/, /e/x/, /topics/x/) share one script.

const ROOT = new URL('.', import.meta.url).href;         // site root URL
const rel = (p) => new URL(p, ROOT).href;

// Claude-powered answers via Supabase edge function; set to '' to fall back
// to extractive mode (passages only, no server).
const ASK_ENDPOINT = 'https://jnouvwxomrcffqwilqkq.supabase.co/functions/v1/ask-archive';

let pagefind = null;
async function getPagefind() {
  if (!pagefind) {
    pagefind = await import(rel('pagefind/pagefind.js'));
    pagefind.init();
  }
  return pagefind;
}

let storiesLite = null;
async function getStories() {
  if (!storiesLite) storiesLite = await (await fetch(rel('data/stories-lite.json'))).json();
  return storiesLite;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Build a ?hl= deep link from a pagefind excerpt's first <mark>ed phrase.
// Edition pages scroll to and highlight it (see highlightFromQuery below) —
// works in every browser, unlike native #:~:text=.
function textFragment(excerpt) {
  const at = excerpt.indexOf('<mark>');
  if (at === -1) return '';
  const plain = excerpt.slice(at).replace(/<[^>]+>/g, '');
  const phrase = plain.split(/\s+/).filter(Boolean).slice(0, 5).join(' ')
    .replace(/[.,;:!?"'”…]+$/, '');
  if (phrase.length < 4) return '';
  return '?hl=' + encodeURIComponent(phrase);
}

// On edition pages: find ?hl= phrase in the body, highlight it, scroll to it.
function highlightFromQuery() {
  const body = document.querySelector('.ed-body');
  const phrase = new URLSearchParams(location.search).get('hl');
  if (!body || !phrase) return;
  const tryFind = (needle) => {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const lower = needle.toLowerCase();
    for (let n; (n = walker.nextNode()); ) {
      const at = n.textContent.toLowerCase().indexOf(lower);
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(n, at);
      range.setEnd(n, at + needle.length);
      const mark = document.createElement('mark');
      mark.className = 'hl-jump';
      range.surroundContents(mark);
      return mark;
    }
    return null;
  };
  // Whole phrase first; progressively fewer words if it spans elements.
  const words = phrase.split(/\s+/);
  let mark = null;
  for (let n = words.length; n >= 1 && !mark; n--) mark = tryFind(words.slice(0, n).join(' '));
  if (mark) {
    // Images above the mark load lazily and shift layout; re-anchor a few
    // times until the page settles.
    const jump = () => mark.scrollIntoView({ block: 'center' });
    jump();
    addEventListener('load', jump);
    for (const ms of [400, 1000, 2000]) setTimeout(jump, ms);
  }
}
highlightFromQuery();

function stripHl(s) { return s.replace(/<[^>]+>/g, '').toLowerCase(); }

// Best original-article match: a story from this edition whose headline shares
// words with the query/excerpt.
function matchStory(stories, editionSlug, query, excerpt) {
  const hay = (query + ' ' + stripHl(excerpt)).toLowerCase();
  const qWords = new Set(query.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  let best = null, bestScore = 0;
  for (const s of stories) {
    if (s.e !== editionSlug) continue;
    const hWords = s.h.toLowerCase().split(/\s+/);
    let score = hWords.filter((w) => w.length > 3 && hay.includes(w)).length;
    score += hWords.filter((w) => qWords.has(w)).length * 2;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return bestScore >= 2 ? best : null;
}

function resultCard(r, stories, query) {
  const slug = r.url.split('/e/')[1]?.replace(/\/.*$/, '') || '';
  const frag = textFragment(r.excerpt);
  const story = matchStory(stories, slug, query, r.excerpt);
  const edUrl = rel(`e/${slug}/index.html`);
  return `<div class="result">
    <h3><a href="${edUrl}${frag}">${esc(r.meta.title || slug)}</a>
      ${story?.g ? '<span class="rof-badge" title="This headline appears in the REAL OR FAKE game">🎮 IN REAL-OR-FAKE</span>' : ''}</h3>
    <p class="excerpt">${r.excerpt}</p>
    <div class="result-links">
      <a class="primary" href="${edUrl}${frag}">Read the edition${frag ? ' ↦ right at that spot' : ''}</a>
      ${story ? `<a href="${esc(story.u)}" target="_blank" rel="noopener">Original article ↗</a>` : ''}
      <a href="${edUrl}">Full edition</a>
    </div>
  </div>`;
}

// ---------- search box ----------
const searchBox = document.getElementById('search-box');
if (searchBox) {
  const out = document.getElementById('search-results');
  let t = null;
  searchBox.addEventListener('input', () => {
    clearTimeout(t);
    const q = searchBox.value.trim();
    if (q.length < 3) { out.innerHTML = ''; return; }
    t = setTimeout(async () => {
      out.innerHTML = '<p class="searching">Searching…</p>';
      const [pf, stories] = await Promise.all([getPagefind(), getStories()]);
      const search = await pf.debouncedSearch(q);
      if (!search) return;
      const results = await Promise.all(search.results.slice(0, 8).map((r) => r.data()));
      if (searchBox.value.trim() !== q) return;
      out.innerHTML = results.length
        ? results.map((r) => resultCard(r, stories, q)).join('') +
          (search.results.length > 8 ? `<p class="searching">…and ${search.results.length - 8} more editions match.</p>` : '')
        : `<p class="empty">No editions mention “${esc(q)}”. Try fewer or different words.</p>`;
    }, 250);
  });
}

// ---------- ask box ----------
const askForm = document.getElementById('ask-form');
if (askForm) {
  const box = document.getElementById('ask-box');
  const out = document.getElementById('ask-results');
  const btn = askForm.querySelector('button');
  askForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const q = box.value.trim();
    if (q.length < 4) return;
    btn.disabled = true;
    out.innerHTML = '<p class="searching">Digging through the archive…</p>';
    try {
      const [pf, stories] = await Promise.all([getPagefind(), getStories()]);
      const search = await pf.search(q);
      const results = await Promise.all(search.results.slice(0, 5).map((r) => r.data()));
      if (!results.length) {
        out.innerHTML = `<div class="ask-answer">The Brief doesn't seem to have covered that. Nothing in ${document.title.match(/\d+/)?.[0] || 'the'} editions matches. Try the search box with different words?</div>`;
        return;
      }
      if (ASK_ENDPOINT) {
        const context = results.map((r) => `[${r.meta.date || ''} — ${r.meta.title}](${r.url})\n${stripHl(r.excerpt)}`).join('\n\n');
        let answer = null;
        try {
          const resp = await fetch(ASK_ENDPOINT, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ question: q, context }),
          });
          if (resp.ok) ({ answer } = await resp.json());
        } catch { /* fall back to passages */ }
        out.innerHTML = (answer
          ? `<div class="ask-answer">${esc(answer).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}</div>`
          : `<div class="ask-answer">Couldn't reach the answer service, so here are the closest passages instead:</div>`)
          + passages(results, stories, q);
      } else {
        out.innerHTML = `<div class="ask-answer">Here's the closest thing the Brief has published: ${results.length} passage${results.length > 1 ? 's' : ''}, newest context first:</div>` + passages(results, stories, q);
      }
    } catch (e) {
      out.innerHTML = `<div class="ask-answer">Something hiccuped (${esc(e.message)}). Try again?</div>`;
    } finally {
      btn.disabled = false;
    }
  });

  function passages(results, stories, q) {
    return results.map((r) => {
      const slug = r.url.split('/e/')[1]?.replace(/\/.*$/, '') || '';
      const frag = textFragment(r.excerpt);
      const story = matchStory(stories, slug, q, r.excerpt);
      return `<div class="passage">
        <p class="excerpt">${r.excerpt}</p>
        <p class="src">from <a href="${rel(`e/${slug}/index.html`)}${frag}">${esc(r.meta.title || slug)}</a>${story ? ` · <a href="${esc(story.u)}" target="_blank" rel="noopener">original article ↗</a>` : ''}</p>
      </div>`;
    }).join('');
  }
}

// ---------- this week, last year ----------
const otd = document.getElementById('otd');
if (otd) {
  (async () => {
    try {
      const editions = await (await fetch(rel('data/editions.json'))).json();
      const now = new Date();
      const target = new Date(Date.UTC(now.getFullYear() - 1, now.getMonth(), now.getDate()));
      const scored = editions
        .filter((e) => e.date)
        .map((e) => ({ e, diff: Math.abs(new Date(e.date + 'T12:00:00Z') - target) }))
        .sort((a, b) => a.diff - b.diff)
        .filter((x) => x.diff < 4 * 864e5)
        .slice(0, 2);
      if (!scored.length) return;
      const stories = await getStories();
      otd.hidden = false;
      document.getElementById('otd-body').innerHTML = scored.map(({ e }) => {
        const top = stories.filter((s) => s.e === e.slug).slice(0, 3);
        return `<div class="otd-ed">
          <h3><a href="${rel(`e/${e.slug}/index.html`)}">${esc(e.title)}</a> <span class="dt">${e.date}</span></h3>
          ${top.length ? `<ul>${top.map((s) => `<li>${esc(s.h)}</li>`).join('')}</ul>` : ''}
        </div>`;
      }).join('');
    } catch { /* widget is optional */ }
  })();
}

// ---------- trivia time capsule (stats page) ----------
const deck = document.getElementById('trivia-deck');
if (deck) {
  const deal = () => {
    const cards = [...deck.querySelectorAll('.trivia')];
    for (const c of cards) {
      c.hidden = true;
      c.querySelector('.tanswer').hidden = true;
      c.querySelector('.reveal-btn').hidden = false;
    }
    for (const c of cards.sort(() => Math.random() - 0.5).slice(0, 3)) {
      c.hidden = false;
      deck.prepend(c);
    }
  };
  deal();
  document.getElementById('trivia-shuffle')?.addEventListener('click', deal);
  deck.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.reveal-btn');
    if (!btn) return;
    btn.hidden = true;
    btn.closest('.trivia').querySelector('.tanswer').hidden = false;
  });
}

// ---------- random edition ----------
const rand = document.getElementById('btn-random');
if (rand) {
  rand.addEventListener('click', async (ev) => {
    ev.preventDefault();
    const editions = await (await fetch(rel('data/editions.json'))).json();
    const pick = editions[Math.floor(Math.random() * editions.length)];
    location.href = rel(`e/${pick.slug}/index.html`);
  });
}
