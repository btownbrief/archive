#!/usr/bin/env node
// Extracts structured data from the archived editions:
//   data/stories.json  — every linked news story (headline, url, quote, commentary,
//                        section, topics, open/close flag, edition, date)
//   data/trivia.json   — per-edition trivia questions + answers where present
//   data/stats.json    — corpus stats for the stats page
// Usage: node scripts/extract.mjs

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = readdirSync(join(ROOT, 'editions')).filter((f) => f.endsWith('.md')).sort();

// Domains that are events/boilerplate, never news stories.
const DENY = /facebook\.com|meetup\.com|eventbrite|beehiiv\.com|btownbrief\.com|ko-fi\.com|google\.com|spotify\.com|streamlit\.app|forms\.gle|instagram\.com|reddit\.com|libcal\.com|seatengine\.com|buytickets\.at|time\.ly|amilia\.com|community\.sevendaysvt\.com|frontporchforum\.com|helloburlingtonvt\.com|youtube\.com|apple\.com|x\.com\/btownbrief|tiiny\.site|kindful|gofundme|paypal|venmo|linktr\.ee|mailto:/i;

const BOILER = /subscribe|sign.?up|read more|click here|sponsor|advertis|btown brief|newsletter|merch|core reader|becoming a|support the|donate|upgrade|full list|keep reading|powered by|news quiz|take the.*quiz|leave a comment|share the brief|refer a friend/i;

function looksLikeHeadline(t) {
  const words = t.split(' ');
  return words.length >= 4 && words.length <= 22 && t.length >= 24 && t.length <= 160 &&
    /^[A-Z0-9$‘'"“]/.test(t) && !BOILER.test(t);
}

const TOPICS = [
  ['housing', /\bhousing|apartment|rent(al|s|ers)?\b|zoning|develop(ment|er)|condo|homeless|shelter|encampment|evict/i],
  ['downtown', /church street|downtown|marketplace|city hall park|pine street|old north end|south end\b/i],
  ['uvm-colleges', /\buvm\b|university of vermont|champlain college|saint michael|st\.? michael|middlebury college/i],
  ['lake-outdoors', /lake champlain|waterfront|bike path|north beach|leddy|oakledge|intervale|\btrail|hik(e|ing)|\bski\b|snowboard|camel'?s hump|mount philo|echo center|\becho\b/i],
  ['weather', /\bsnow|storm|flood|heat ?wave|temperature|climate|\bice\b|pancake ice|rainfall|drought|foliage/i],
  ['food-drink', /restaurant|caf[eé]|brewer|bakery|creemee|\bfood\b|pizza|coffee|taproom|\bmenu\b|\bchef|cidery|distill|farmers market|food truck|deli\b|diner\b|cocktail|maple/i],
  ['arts-music', /concert|\bmusic\b|\bband\b|festival|\bart\b|\barts\b|gallery|theat(er|re)|\bfilm\b|comedy|mural|jazz|museum|author|\bbook\b/i],
  ['politics', /city council|mayor|ballot|election|\bvote\b|legislature|statehouse|governor|selectboard|budget|\btax(es)?\b|town meeting|senator|congress/i],
  ['transportation', /\bbus(es)?\b|green mountain transit|\bgmt\b|parking|highway|amtrak|airport|flight|traffic|bridge|roundabout|railyard|ferry|scooter|e-?bike/i],
  ['public-safety', /police|\bfire\b|firefighter|crash|arrest|\bcourt\b|crime|theft|shooting|overdose|rescue|missing/i],
  ['business', /business|\bstore\b|\bshop\b|company|startup|\bceo\b|\bjobs\b|layoff|grand opening|entrepreneur|market\b/i],
  ['sports', /catamounts?|hockey|basketball|soccer|baseball|lake monsters|vermont green|athletics|playoff|champion/i],
];

const OPENING = /\b(open(s|ed|ing)?|debut(s|ed)?|launch(es|ed)?|coming to|arriv(es|ing)|expands? into|new location|breaks ground|grand opening)\b/i;
const CLOSING = /\b(clos(es|ed|ing)|shutter(s|ed|ing)?|last day|says goodbye|final (day|weekend|service)|shuts? down|out of business|loses its lease|farewell|calls it quits|no longer)\b/i;

const stories = [];
const trivia = [];
const seen = new Set();
let totalWords = 0;
const editionsMeta = [];

for (const file of files) {
  const raw = readFileSync(join(ROOT, 'editions', file), 'utf8');
  const fm = raw.split('\n---\n')[0];
  const body = raw.split('\n---\n').slice(1).join('\n---\n');
  const slug = file.replace(/^\d{4}-\d{2}-\d{2}--/, '').replace(/\.md$/, '');
  const date = (fm.match(/^date: (\S+)$/m) || [])[1];
  const url = (fm.match(/^url: (\S+)$/m) || [])[1];
  const title = (fm.match(/^title: "(.*)"$/m) || [])[1];
  const words = body.split(/\s+/).length;
  totalWords += words;
  editionsMeta.push({ slug, date, title, words });

  const lines = body.split('\n');
  let section = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const h = line.match(/^#{1,4} (.+)$/);
    if (h && !h[1].startsWith('[')) section = h[1].replace(/[*_]/g, '').trim();

    // Story shapes: "# [t](u)" heading-link or "**[t](u)**" bold standalone.
    const m = line.match(/^#{1,4} \[([^\]]+)\]\((https?:[^)]+)\)$/) ||
              line.match(/^\*\*\[([^\]]+)\]\((https?:[^)]+)\)\*\*$/) ||
              line.match(/^\[([^\]]+)\]\((https?:[^)]+)\)$/);
    if (!m) continue;
    const [, headline, href] = m;
    if (DENY.test(href) || !looksLikeHeadline(headline)) continue;
    const key = headline.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);

    // Grab pull-quote + commentary: next paragraphs, skipping the ❝ marker.
    let quote = '', commentary = '';
    for (let j = i + 1, got = 0; j < lines.length && got < 2; j++) {
      const t = lines[j].trim();
      if (!t || t === '❝') continue;
      if (/^#{1,4} |^\*\*\[|^!\[|^---$/.test(t)) break;
      if (got === 0) quote = t; else commentary = t;
      got++;
    }
    const hay = `${headline} ${quote} ${commentary}`;
    const topics = TOPICS.filter(([, re]) => re.test(hay)).map(([t]) => t);
    let openClose = null;
    if (topics.includes('food-drink') || topics.includes('business') || topics.includes('downtown')) {
      if (CLOSING.test(headline)) openClose = 'closing';
      else if (OPENING.test(headline)) openClose = 'opening';
    }
    stories.push({ headline, url: href, quote, commentary, section, topics, openClose, edition: slug, editionUrl: url, date });
  }

  // Trivia: question after a "trivia question" marker; options (A)-(D); answer near "answer".
  const tAt = body.search(/trivia question/i);
  if (tAt !== -1) {
    const after = body.slice(tAt).split('\n').slice(1, 20).map((l) => l.trim());
    let question = null;
    const options = [];
    for (const l of after) {
      if (!l) continue;
      const om = l.match(/^[(*]*([A-D])[).* ]+\s*(.+)$/);
      if (question && om) { options.push(om[2].replace(/[*_]/g, '').trim()); if (options.length === 4) break; continue; }
      if (question && options.length) break;
      if (!question) {
        const q = l.replace(/[*_]/g, '').replace(/\((check the bottom for answer|answer at the bottom)\)/i, '').trim();
        if (q.endsWith('?')) question = q;
        else if (/local news/i.test(q)) break;
      } else break;
    }
    if (question) {
      const answers = [...body.matchAll(/^\**(?:trivia )?answer\**[:\s]+(.+)$/gim)].map((a) => a[1].replace(/[*_]/g, '').trim());
      const answer = answers.at(-1) || null;
      trivia.push({ edition: slug, date, question, options, answer: answer && !/bottom/i.test(answer) ? answer : null });
    }
  }
}

// Stats.
const domain = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
const srcCount = {};
for (const s of stories) { const d = domain(s.url); if (d) srcCount[d] = (srcCount[d] || 0) + 1; }
const PLACES = ['Church Street', 'Winooski', 'Old North End', 'Pine Street', 'South End', 'Lake Champlain', 'North Beach', 'Leddy', 'Oakledge', 'City Hall Park', 'Waterfront', 'UVM', 'Church St', 'Intervale', 'ECHO', 'City Market', 'Battery Park', 'Shelburne', 'Essex', 'South Burlington', 'Colchester', 'Williston', 'Montpelier', 'North Ave', 'Flynn', 'Nectar’s', 'Higher Ground'];
const placeCount = {};
for (const file of files) {
  const body = readFileSync(join(ROOT, 'editions', file), 'utf8');
  for (const p of PLACES) {
    const n = (body.match(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
    if (n) placeCount[p] = (placeCount[p] || 0) + n;
  }
}
placeCount['Church Street'] = (placeCount['Church Street'] || 0) + (placeCount['Church St'] || 0);
delete placeCount['Church St'];

const longest = [...editionsMeta].sort((a, b) => b.words - a.words)[0];
const stats = {
  editions: files.length,
  totalWords,
  avgWords: Math.round(totalWords / files.length),
  longest,
  firstDate: editionsMeta[0].date,
  lastDate: editionsMeta.at(-1).date,
  stories: stories.length,
  triviaCount: trivia.length,
  openings: stories.filter((s) => s.openClose === 'opening').length,
  closings: stories.filter((s) => s.openClose === 'closing').length,
  topSources: Object.entries(srcCount).sort((a, b) => b[1] - a[1]).slice(0, 12),
  topPlaces: Object.entries(placeCount).sort((a, b) => b[1] - a[1]).slice(0, 15),
  topicCounts: Object.fromEntries(TOPICS.map(([t]) => [t, stories.filter((s) => s.topics.includes(t)).length])),
};

writeFileSync(join(ROOT, 'data', 'stories.json'), JSON.stringify(stories, null, 1) + '\n');
writeFileSync(join(ROOT, 'data', 'trivia.json'), JSON.stringify(trivia, null, 1) + '\n');
writeFileSync(join(ROOT, 'data', 'stats.json'), JSON.stringify(stats, null, 2) + '\n');
console.log(`${stories.length} stories, ${trivia.length} trivia, openings ${stats.openings} / closings ${stats.closings}`);
console.log('editions with stories:', new Set(stories.map((s) => s.edition)).size);
console.log('top sources:', stats.topSources.slice(0, 5).map(([d, n]) => `${d}:${n}`).join(' '));
