// Supabase Edge Function: archive-unlock
// Gate for the Full Archive page. Two actions:
//   { action: 'verify', email }  → checks beehiiv for an active $10+/mo
//                                  subscription and returns a signed token
//   { action: 'data', token }    → validates the token and returns a
//                                  short-lived signed URL for premium.json
//                                  in the private `archive-premium` bucket
//
// Deploy:
//   supabase functions deploy archive-unlock --project-ref jnouvwxomrcffqwilqkq --no-verify-jwt
// Secrets:
//   supabase secrets set BEEHIIV_API_KEY=...        (beehiiv Settings → API)
//   supabase secrets set PREMIUM_TOKEN_SECRET=...   (any long random string)
// Reuses the ask_rate_check() rate limit (10/min per IP) on verify.

const PUBLICATION_ID = 'pub_d130f553-e113-4e8f-b0a0-bbed2a253e93';
// Tiers that unlock the archive: $10 Tier and $20 Tier ($5 stays newsletter-only).
// The raw v2 API reports premium tiers as names (subscription_premium_tier_names),
// so match on both name and id.
const ALLOWED_TIERS = new Set([
  '$10 Tier', 'tier_fdc7fc36-ad20-4529-861e-243174f2432c',
  '$20 Tier', 'tier_1ed50015-790d-4445-a7f0-9d979f6adddd',
]);
const TOKEN_DAYS = 60;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Legacy JWT service key: storage/PostgREST reject the new sb_secret_ format
// that SUPABASE_SERVICE_ROLE_KEY auto-injects on this project.
const svcKey = () => Deno.env.get('SERVICE_JWT') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmacKey() {
  return crypto.subtle.importKey('raw', enc.encode(Deno.env.get('PREMIUM_TOKEN_SECRET')!),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function makeToken(email: string): Promise<{ token: string; exp: number }> {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_DAYS * 86400;
  const emailHash = b64url(await crypto.subtle.digest('SHA-256', enc.encode(email))).slice(0, 12);
  const payload = b64url(enc.encode(JSON.stringify({ e: emailHash, x: exp })));
  const sig = b64url(await crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(payload)));
  return { token: `${payload}.${sig}`, exp };
}

async function validToken(token: string): Promise<boolean> {
  try {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return false;
    const raw = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(), raw, enc.encode(payload));
    if (!ok) return false;
    const { x } = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof x === 'number' && x * 1000 > Date.now();
  } catch {
    return false;
  }
}

// Same durable limiter the ask box uses; fails open on DB errors.
async function rateLimited(ip: string): Promise<boolean> {
  try {
    const resp = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/ask_rate_check`, {
      method: 'POST',
      headers: {
        apikey: svcKey(),
        authorization: `Bearer ${svcKey()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_ip: ip }),
    });
    if (!resp.ok) return false;
    return (await resp.json()) === false;
  } catch {
    return false;
  }
}

async function verify(email: string) {
  // Comp list (owner, friends & family) — lives in a secret, not this public repo:
  //   supabase secrets set COMP_EMAILS=a@x.com,b@y.com
  const comps = (Deno.env.get('COMP_EMAILS') || '').toLowerCase().split(',').map((e) => e.trim());
  if (comps.includes(email)) return json(await makeToken(email));

  const resp = await fetch(
    `https://api.beehiiv.com/v2/publications/${PUBLICATION_ID}/subscriptions/by_email/${encodeURIComponent(email)}`,
    { headers: { authorization: `Bearer ${Deno.env.get('BEEHIIV_API_KEY')!}` } },
  );
  if (resp.status === 404) return json({ error: 'not_subscribed' }, 403);
  if (!resp.ok) return json({ error: `beehiiv ${resp.status}` }, 502);
  const sub = (await resp.json()).data;
  const active = sub?.status === 'active';
  const tiers: string[] = [
    ...(sub?.subscription_premium_tier_names ?? []),
    ...(sub?.tiers ?? []).flatMap((t: { id?: string; name?: string }) => [t.id, t.name]),
  ].filter(Boolean);
  const premium = tiers.some((t) => ALLOWED_TIERS.has(t));
  if (!active || !premium) return json({ error: 'not_premium' }, 403);
  return json(await makeToken(email));
}

async function signedDataUrl() {
  const base = Deno.env.get('SUPABASE_URL')!;
  const resp = await fetch(`${base}/storage/v1/object/sign/archive-premium/premium.json`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${svcKey()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: 3600 }),
  });
  if (!resp.ok) return json({ error: `storage ${resp.status}: ${(await resp.text()).slice(0, 200)}` }, 502);
  const { signedURL } = await resp.json();
  return json({ url: `${base}/storage/v1${signedURL}` });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: { action?: string; email?: string; token?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  if (body.action === 'verify') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
    if (await rateLimited(ip)) return json({ error: 'rate limited' }, 429);
    const email = (body.email || '').trim().toLowerCase().slice(0, 254);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'bad email' }, 400);
    return verify(email);
  }

  if (body.action === 'data') {
    if (!(await validToken(body.token || ''))) return json({ error: 'invalid token' }, 401);
    return signedDataUrl();
  }

  return json({ error: 'unknown action' }, 400);
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}
