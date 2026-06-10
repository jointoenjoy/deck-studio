// deck-studio · 簡報雲端永久保存（Cloudflare KV）
// 需要：KV binding DECKS（見 wrangler.toml）、環境變數 DECK_PASSWORD（沿用解鎖密碼）
// 一份簡報存成 KV key `deck:<id>`，值為 {id,name,updated,data}；metadata 放 {name,updated} 方便列表

function json(o, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
function auth(req, env) {
  const p = req.headers.get('x-deck-pass') || '';
  return !!env.DECK_PASSWORD && p === String(env.DECK_PASSWORD);
}

// GET：無 id → 列出全部；?id=xxx → 載入單份
export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DECKS) return json({ error: '雲端儲存未設定（KV binding DECKS 未綁定）' }, 500);
  if (!auth(request, env)) return json({ error: '密碼錯誤，請先在「新增頁面」用團隊密碼解鎖' }, 401);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (id) {
    const v = await env.DECKS.get('deck:' + id);
    if (!v) return json({ error: '找不到此簡報' }, 404);
    return json({ ok: true, deck: JSON.parse(v) });
  }
  const list = await env.DECKS.list({ prefix: 'deck:' });
  const items = list.keys.map((k) => ({ id: k.name.replace('deck:', ''), name: (k.metadata && k.metadata.name) || '未命名', updated: (k.metadata && k.metadata.updated) || 0 }));
  items.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  return json({ ok: true, items });
}

// POST：儲存一份（body: {id?, name, data}）
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DECKS) return json({ error: '雲端儲存未設定（KV binding DECKS 未綁定）' }, 500);
  if (!auth(request, env)) return json({ error: '密碼錯誤' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: '格式錯誤' }, 400); }
  const id = String(body.id || ('d' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)));
  const name = String(body.name || '未命名簡報').slice(0, 80);
  const updated = Date.now();
  const data = body.data || {};
  const payload = JSON.stringify({ id, name, updated, data });
  if (payload.length > 24 * 1024 * 1024) return json({ error: '簡報太大（超過 24MB），請減少內嵌圖片' }, 413);
  await env.DECKS.put('deck:' + id, payload, { metadata: { name, updated } });
  return json({ ok: true, id, name, updated });
}

// DELETE：?id=xxx
export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!env.DECKS) return json({ error: '雲端儲存未設定' }, 500);
  if (!auth(request, env)) return json({ error: '密碼錯誤' }, 401);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: '缺少 id' }, 400);
  await env.DECKS.delete('deck:' + id);
  return json({ ok: true });
}
