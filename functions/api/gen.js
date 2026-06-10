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
  const templates = (body.templates && typeof body.templates === 'object') ? body.templates : null;
  const image = typeof body.image === 'string' ? body.image : null;
  const auto = !tpl && !!templates;  // 沒指定版型且有提供版型清單 → 由 AI 自動挑版型

  const indName = IND_NAME[industry] || '通用';
  const TPL_DESC = {
    cover: '封面／標題頁（開場用）',
    bigstat: '震撼數據頁，凸顯單一關鍵數字（僅在內容有明確、真實的數據時才選）',
    barchart: '長條圖，把 2-5 筆可比較的數據用橫條圖呈現（適合圖表類圖片、或多筆數字比較；數值請忠實讀自圖片或描述，不要捏造）',
    painpoint3: '痛點三欄，並列三個問題或重點',
    service: '服務卡，介紹三個服務／方案／項目',
    step: '流程頁，三個步驟',
    strategy: '策略行動頁，三項行動建議',
    origin: '故事頁，敘述起源／理念',
    cta: '結尾頁，呼籲行動／聯絡',
    matrix: '四象限／矩陣',
  };
  const brand =
    '你是「練息場 Join to Enjoy」的簡報文案專家。練息場是職場身心健康品牌（優勢幸福力＋療癒工作坊），' +
    '語氣溫暖、專業、有同理心，重視科學實證與預防式身心健康。';
  const rules =
    '每個欄位填入精煉、有力、符合練息場調性的繁體中文。標題短促有記憶點，說明一句話講清楚，不要空話。' +
    '【最重要】絕對不要捏造不存在的數據；若內容沒有明確的真實數字，就不要選或填「震撼數據(bigstat)」這種需要數字的版型。';
  let sys;
  if (auto) {
    const menu = Object.keys(templates).map((k) => '・' + k + '：' + (TPL_DESC[k] || '') + ' → 欄位：' + JSON.stringify(templates[k])).join('\n');
    sys = brand +
      '請依使用者的描述（若附圖也請看懂圖片內容一併參考），從下列版型中【挑一個最適合的】，再為該版型撰寫文案：\n' + menu + '\n' +
      '只輸出一個 JSON 物件，格式為 {"template":"你挑的版型key","fields":{該版型欄位的文案}}，不要任何說明或 markdown。' +
      'template 必須是上面清單中的 key；fields 必須且只能包含該版型對應的欄位。' + rules;
  } else {
    sys = brand +
      '請依使用者的描述（若附了圖片，也請看懂圖片內容一併參考），為一張「' + tpl + '」版型的投影片撰寫文案。' +
      '只輸出一個 JSON 物件，不要任何說明文字或 markdown 標記。' +
      'JSON 必須且只能包含這些欄位：' + JSON.stringify(fields) + '。' + rules;
  }

  const hasImg = !!(image && image.startsWith('data:'));
  const imgNote = hasImg ? '【重要】使用者附上了一張圖片。請仔細閱讀圖片中的文字與視覺內容，並【結合下方使用者的文字描述】，綜合成這一頁簡報的文案——兩者都要考慮，不要只看其中一個。\n' : '';
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

  // auto 模式：obj = {template, fields}；手動模式：obj = fields
  let outTpl = tpl, outFields = obj;
  if (auto && obj && typeof obj === 'object') {
    if (obj.template && templates[obj.template]) outTpl = obj.template;
    outFields = (obj.fields && typeof obj.fields === 'object') ? obj.fields : obj;
  }

  const u = data.usageMetadata || {};
  return json({
    template: outTpl,
    fields: outFields,
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
