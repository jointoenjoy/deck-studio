// deck-studio · AI 生成頁面後端代理（Cloudflare Pages Function）
// 金鑰只存在 Cloudflare 環境變數，永不出現在前端公開頁。
// 需要設定的環境變數：
//   GEMINI_API_KEY  你的 Google AI Studio 金鑰（AIza...）
//   DECK_PASSWORD   團隊解鎖用的密碼（自訂）
//   GEMINI_MODEL    （選填）預設 gemini-2.0-flash

const IND_NAME = {
  marketing: '行銷/廣告', tech: '高科技/B2B', medical: '醫療/照護',
  gov: '政府/公部門', edu: '教育/學校', _core: '通用',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); }
  catch { return json({ error: '請求格式錯誤' }, 400); }

  // 密碼鎖：擋掉沒密碼或密碼錯的人，避免公開頁被陌生人燒額度
  if (!env.DECK_PASSWORD || String(body.password || '') !== String(env.DECK_PASSWORD)) {
    return json({ error: '密碼錯誤，請向管理者索取' }, 401);
  }
  if (!env.GEMINI_API_KEY) {
    return json({ error: '伺服器尚未設定 GEMINI_API_KEY' }, 500);
  }

  const intent = String(body.intent || '').slice(0, 4000);
  const tpl = String(body.tpl || '');
  const industry = String(body.industry || '');
  const fields = Array.isArray(body.fields) ? body.fields.slice(0, 40) : [];
  const image = typeof body.image === 'string' ? body.image : null;

  const indName = IND_NAME[industry] || '通用';
  const sys =
    '你是「練息場 Join to Enjoy」的簡報文案專家。練息場是職場身心健康品牌（優勢幸福力＋療癒工作坊），' +
    '語氣溫暖、專業、有同理心，重視科學實證與預防式身心健康。' +
    '請依使用者的描述（若附了圖片，也請看懂圖片內容一併參考），為一張「' + tpl + '」版型的投影片撰寫文案。' +
    '只輸出一個 JSON 物件，不要任何說明文字或 markdown 標記。' +
    'JSON 必須且只能包含這些欄位：' + JSON.stringify(fields) + '。' +
    '每個欄位填入精煉、有力、符合練息場調性的繁體中文（數字類欄位給具體數字或百分比）。' +
    '標題短促有記憶點，說明文字一句話講清楚，不要空話。';

  const hasImg = !!(image && image.startsWith('data:'));
  const imgNote = hasImg ? '【重要】使用者附上了一張圖片，請仔細閱讀圖片中的文字與視覺內容，作為這頁文案的主要依據。\n' : '';
  const parts = [{ text: imgNote + '產業對象：' + indName + '\n這頁想說的重點：\n' + intent }];
  if (hasImg) {
    const m = image.match(/^data:(.*?);base64,(.*)$/);
    if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
  }

  const reqModel = (typeof body.model === 'string' && /^(gemini|gemma)[\w.\-]*$/.test(body.model)) ? body.model : '';
  const model = reqModel || env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    model + ':generateContent?key=' + env.GEMINI_API_KEY;

  const payload = {
    systemInstruction: { parts: [{ text: sys }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.7, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } },
  };

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return json({ error: '無法連線 Gemini：' + String(e).slice(0, 120) }, 502);
  }

  if (!resp.ok) {
    let msg = '';
    try { const j = await resp.json(); msg = (j.error && j.error.message) || JSON.stringify(j); }
    catch { msg = await resp.text(); }
    console.log('GEMINI_FAIL', resp.status, String(msg).slice(0, 300));
    return json({ error: 'Gemini ' + resp.status + '：' + String(msg).slice(0, 200) }, 502);
  }

  const data = await resp.json();
  const txt = ((data.candidates && data.candidates[0] &&
    data.candidates[0].content && data.candidates[0].content.parts) || [])
    .map((p) => p.text || '').join('').trim();

  let obj;
  try { obj = JSON.parse(txt.replace(/^```json|^```|```$/g, '').trim()); }
  catch { return json({ error: 'Gemini 回傳非 JSON：' + txt.slice(0, 100) }, 502); }

  const u = data.usageMetadata || {};
  return json({
    fields: obj,
    model: model,
    sawImage: hasImg,
    inTok: u.promptTokenCount || 0,
    outTok: u.candidatesTokenCount || 0,
  });
}

// 診斷用：列出可用模型（GET /api/gen）；?selftest=1 會實際生成一次自我驗證（只回模型名與測試結果，不含金鑰）
export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.GEMINI_API_KEY) return json({ error: '未設定 GEMINI_API_KEY' }, 500);
  const url = new URL(request.url);
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  if (url.searchParams.get('selftest')) {
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + env.GEMINI_API_KEY, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: '請回一個 JSON 物件：{"ok":true}' }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 256, thinkingConfig: { thinkingBudget: 0 } } }),
      });
      const j = await r.json();
      const txt = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map((p) => p.text || '').join('');
      return json({ selftest: true, model, httpStatus: r.status, ok: r.ok, sample: txt.slice(0, 120), err: r.ok ? null : (j.error && j.error.message) });
    } catch (e) { return json({ selftest: true, model, error: String(e).slice(0, 200) }, 502); }
  }
  try {
    const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' + env.GEMINI_API_KEY);
    const data = await resp.json();
    const models = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => String(m.name).replace('models/', ''));
    return json({ available: models });
  } catch (e) {
    return json({ error: String(e).slice(0, 200) }, 502);
  }
}
