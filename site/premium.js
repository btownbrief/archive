// Btown Brief Full Archive — supporter gate + goldmine renderer.
// Verification and data both go through the archive-unlock edge function:
//   { action:'verify', email } → { token, exp }  (active $10+/mo beehiiv sub)
//   { action:'data', token }   → { url }         (short-lived signed URL)
// The premium dataset never ships with the static site.

const UNLOCK_ENDPOINT = 'https://jnouvwxomrcffqwilqkq.supabase.co/functions/v1/archive-unlock';
const STORE_KEY = 'bb-archive-premium'; // namespaced: play.btownbrief.com shares localStorage across games

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const locked = $('pm-locked'), open = $('pm-open');
if (locked && open) init();

function getSession() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s?.token && s.exp * 1000 > Date.now() + 864e5) return s; // ≥1 day left
  } catch { /* fall through */ }
  return null;
}

async function init() {
  const session = getSession();
  if (session) {
    const ok = await unlock(session.token);
    if (!ok) { localStorage.removeItem(STORE_KEY); showLocked(); }
  }

  $('pm-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = $('pm-email').value.trim().toLowerCase();
    if (!email) return;
    const btn = ev.target.querySelector('button');
    btn.disabled = true;
    msg('Checking the supporter list…');
    try {
      const resp = await fetch(UNLOCK_ENDPOINT, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'verify', email }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.token) {
        localStorage.setItem(STORE_KEY, JSON.stringify({ token: data.token, exp: data.exp, email }));
        msg('');
        await unlock(data.token);
      } else if (data.error === 'not_subscribed') {
        msg(`That email isn't on the newsletter list yet. <a href="https://www.btownbrief.com" target="_blank" rel="noopener">Subscribe free first</a>, then <a href="https://www.btownbrief.com/upgrade" target="_blank" rel="noopener">upgrade to $10/month</a> — and come right back!`);
      } else if (data.error === 'not_premium') {
        msg(`You're on the free list — thank you for reading! 💛 The Full Archive is a perk for $10/month supporters. <a href="https://www.btownbrief.com/upgrade" target="_blank" rel="noopener">Upgrade here</a> (t-shirt included after 6 months), then unlock with this same email.`);
      } else if (resp.status === 429) {
        msg('Whoa, too many tries — give it a minute and try again.');
      } else {
        msg('Hmm, the unlock service hiccuped. Try again in a moment?');
      }
    } catch {
      msg('Couldn’t reach the unlock service — check your connection and try again.');
    } finally {
      btn.disabled = false;
    }
  });

  $('pm-signout').addEventListener('click', () => {
    localStorage.removeItem(STORE_KEY);
    showLocked();
  });

  $('pm-filter').addEventListener('input', () => filter($('pm-filter').value.trim().toLowerCase()));
}

function msg(html) {
  $('pm-msg').innerHTML = html ? `<div class="ask-answer">${html}</div>` : '';
}

function showLocked() { locked.hidden = false; open.hidden = true; }

async function unlock(token) {
  locked.hidden = true;
  open.hidden = false;
  try {
    const resp = await fetch(UNLOCK_ENDPOINT, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'data', token }),
    });
    if (!resp.ok) return false;
    const { url } = await resp.json();
    const data = await (await fetch(url)).json();
    render(data);
    return true;
  } catch {
    $('pm-body').innerHTML = '<p class="empty">Couldn’t load the archive just now — refresh to try again.</p>';
    return true; // token was accepted; only the data fetch failed
  }
}

const monthName = (k) => new Date(k + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDate = (d) => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';

function render(data) {
  const months = new Map();
  for (const e of data.editions) {
    const k = (e.date || '').slice(0, 7);
    if (!months.has(k)) months.set(k, []);
    months.get(k).push(e);
  }
  const nStories = data.editions.reduce((n, e) => n + e.stories.length, 0);
  let html = `<p class="tagline">${data.editions.length} editions · ${nStories.toLocaleString()} stories with full summaries · updated ${esc(data.generated)}</p>`;
  let i = 0;
  for (const [k, eds] of months) {
    const count = eds.reduce((n, e) => n + e.stories.length, 0);
    html += `<details class="pm-month"${i++ < 2 ? ' open' : ''}><summary>${monthName(k)} <span class="count">${eds.length} editions · ${count} stories</span></summary>`;
    for (const e of eds) {
      html += `<div class="pm-ed">
        <h3><a href="../e/${esc(e.slug)}/index.html">${esc(e.title)}</a> <span class="dt">${shortDate(e.date)}</span></h3>
        ${e.stories.map((s) => `<div class="pm-story" data-hay="${esc((s.h + ' ' + s.c + ' ' + s.q).toLowerCase())}">
          ${s.oc ? `<span class="oc oc-${s.oc}">${s.oc === 'opening' ? 'OPENED' : 'CLOSED'}</span>` : ''}
          <h4><a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.h)}</a></h4>
          ${s.q ? `<p class="quote">${esc(s.q.replace(/\*[^*]*\*\s*$/, '').trim())}</p>` : ''}
          ${s.c ? `<p class="commentary">${esc(s.c)}</p>` : ''}
        </div>`).join('')}
      </div>`;
    }
    html += '</details>';
  }
  $('pm-body').innerHTML = html;
}

function filter(q) {
  const months = document.querySelectorAll('.pm-month');
  for (const m of months) {
    let monthHits = 0;
    for (const ed of m.querySelectorAll('.pm-ed')) {
      let hits = 0;
      for (const st of ed.querySelectorAll('.pm-story')) {
        const show = !q || st.dataset.hay.includes(q);
        st.hidden = !show;
        if (show) hits++;
      }
      ed.hidden = hits === 0;
      monthHits += hits;
    }
    m.hidden = monthHits === 0;
    if (q && monthHits) m.open = true;
  }
}
