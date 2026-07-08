// Supabase Edge Function: ask-archive
// Turns "Ask the archive" from extractive mode into real Claude-written answers.
// The browser does the retrieval (Pagefind) and sends the question plus the
// top passages; this function only asks Claude to answer from that context —
// the API key never reaches the client.
//
// Deploy (one-time, needs `supabase login` first):
//   supabase functions deploy ask-archive --project-ref jnouvwxomrcffqwilqkq
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref jnouvwxomrcffqwilqkq
// Then set ASK_ENDPOINT in site/archive.js to the function URL and redeploy the site.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: { question?: string; context?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const question = (body.question || '').slice(0, 300).trim();
  const context = (body.context || '').slice(0, 12000).trim();
  if (!question || !context) return json({ error: 'question and context required' }, 400);

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system:
        'You answer questions about Burlington, Vermont using ONLY the provided Btown Brief newsletter passages. ' +
        'Answer in 2-4 friendly sentences. Always name the edition date(s) you drew from. ' +
        "If the passages don't answer the question, say so plainly and suggest what to search instead. Never invent facts.",
      messages: [{ role: 'user', content: `Passages from the archive:\n\n${context}\n\nQuestion: ${question}` }],
    }),
  });
  if (!resp.ok) return json({ error: `claude ${resp.status}` }, 502);
  const data = await resp.json();
  return json({ answer: data.content?.[0]?.text ?? 'No answer.' });
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}
