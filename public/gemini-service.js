// public/gemini-service.js
// Sends numeric inputs to server; expects normalized JSON back.
// No client-side "local device" fallback — if server/LLM fails, we throw.

const TIMEOUT_MS = 15000;

export async function analyzeFinancialData(data) {
  // Keep legacy prompt for compatibility with older servers; not relied upon.
  const prompt = buildFinancialPrompt(data);
  const inputs = prepareInputs(data);

  const { ok, json } = await postJson(
    '/analyze',
    { prompt, inputs, client: 'web-1.9' },
    TIMEOUT_MS
  );

  if (!ok) {
    const msg = stringifyErr(json) || 'Server error';
    throw new Error(msg);
  }

  // Path A: normalized JSON from server (preferred)
  if (looksNormalized(json)) {
    const out = finalizeForUI(json);
    try { window.pennyShowMessage && window.pennyShowMessage(out.message); } catch {}
    return out;
  }

  // Path B: legacy raw candidates -> parse locally (still server-sourced)
  const parsed = parseGeminiCandidates(json);
  if (parsed && looksNormalized(parsed)) {
    const out = finalizeForUI(parsed);
    try { window.pennyShowMessage && window.pennyShowMessage(out.message); } catch {}
    return out;
  }

  // No client/device fallback — force caller to handle the miss.
  throw new Error('Invalid server response');
}

/* ------------------------------ fetch helpers ------------------------------ */

async function postJson(url, body, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, json: j };
  } finally {
    clearTimeout(t);
  }
}

/* -------------------------------------------------------------------------- */
/* Legacy prompt (server ignores this, but we keep it consistent)             */
/* -------------------------------------------------------------------------- */

function buildFinancialPrompt(data) {
  return `
You are Penny, a kind money helper in a game. Speak so a ten year old understands.
Pretend this is a pet game. Your words help the pet level up.

Style rules:
- No emojis
- No parentheses
- No colons
- No symbols like percent signs or slashes or less than or greater than
- Use short full sentences in plain English
- Do not use hard words like debt to income or ratio or runway
- Do not mention investing, investments, stocks, auto moves, or investing accounts
- Use simple phrases like money you bring in each month, money you spend each month, savings you already have, money you owe, your current balance and the amount you just added or took out
- Write numbers with words like percent, months, dollars
- Each sentence should include one clear number
- JSON ONLY, no code fences, no extra keys

Return EXACTLY this shape:
{
  "state": "ATROCIOUS|CRITICAL|STRUGGLING|SURVIVING|HEALTHY|THRIVING|FANTASTIC",
  "health": 0,
  "headline": "string",
  "advice": ["string","string","string"]
}

What to write:
- headline = one cute sentence that explains how the pet is doing in the game
- advice[0] = one positive sentence with a number that says what is going well
- advice[1] = one helpful change with a number that makes the pet stronger
- advice[2] = the FINAL sentence shown after a transaction line: ONE short sentence
  that summarizes bank health and gives one concrete action using the numbers.
  Do NOT repeat the transaction amount or budget percent. No investing.

User data:
- monthly_income: ${numOrZero(data.income)}
- monthly_spending: ${numOrZero(data.spending)}
- total_savings: ${numOrZero(data.savings)}
- total_debt: ${numOrZero(data.debt)}
- current_balance: ${numOrZero(data.currentBalance)}
- transaction_amount: ${numOrZero(data.transactionAmount)}
- day_count: ${numOrZero(data.dayCount)}
- total_deposits_mtd: ${numOrZero(data.totalDepositsMtd)}
- total_withdrawals_mtd: ${numOrZero(data.totalWithdrawalsMtd)}
- net_mtd: ${numOrZero(data.netMtd)}
- projected_spending_share: ${numOrZero(data.projectedSpendingShare)}
- health_score: ${numOrZero(data.health)}
- state_name: ${String(data.state || '')}
`.trim();
}

/* --------------------------------- Helpers -------------------------------- */

function prepareInputs(d){
  return {
    monthly_income: Number(d.income) || 0,
    monthly_spending: Number(d.spending) || 0,
    total_savings: Number(d.savings) || 0,
    total_debt: Number(d.debt) || 0,
    current_balance: Number(d.currentBalance) || 0,
    transaction_amount: Number(d.transactionAmount) || 0,

    // legacy fields kept for compatibility; server ignores for advice:
    monthly_investments: Number(d.monthlyInvestments) || 0,
    investment_balance: Number(d.investmentBalance) || 0
  };
}

function numOrZero(x){ const n = Number(x); return Number.isFinite(n) ? n : 0; }

function stringifyErr(x) {
  if (!x) return '';
  if (typeof x === 'string') return x;
  if (x.error && typeof x.error === 'string') return x.error;
  if (x.error && typeof x.error.message === 'string') return x.error.message;
  try { return JSON.stringify(x); } catch { return String(x); }
}

function looksNormalized(obj){
  const allowed = ['ATROCIOUS','CRITICAL','STRUGGLING','SURVIVING','HEALTHY','THRIVING','FANTASTIC'];
  return (
    obj &&
    typeof obj.health === 'number' &&
    (typeof obj.message === 'string' || typeof obj.headline === 'string') &&
    allowed.includes(String(obj.state).toUpperCase())
  );
}

/* ----------------------------- Text sanitizing ----------------------------- */

function sanitizeLine(s) {
  let t = String(s || '');
  t = t.replace(/[\u2600-\u26FF\u{1F300}-\u{1FAFF}\u200B-\u200D\uFE0F\uFEFF]/gu, '');
  t = t.replace(/[():]/g, ' ');
  t = t.replace(/<=|≤/g, ' at or below ');
  t = t.replace(/>=|≥/g, ' at or above ');
  t = t.replace(/~/g,  ' about ');
  t = t.replace(/%/g,  ' percent ');
  t = t.replace(/\b(\d+)\s*\/\s*(wk|week)\b/gi, '$1 per week');
  t = t.replace(/\b(\d+)\s*\/\s*(mo|month)\b/gi, '$1 per month');
  t = t.replace(/\b(\d+)\s*\/\s*(yr|year)\b/gi, '$1 per year');
  t = t.replace(/\//g, ' per ');
  t = t.replace(/\bDTI\b/gi, 'debt to income');
  t = t.replace(/\brunway\b/gi, 'months of savings');
  t = t.replace(/\bratio\b/gi, 'share');
  t = t.replace(/^\s*(good|fix|goal( next week)?)\b[\s\-]*/i, '');
  t = t.replace(/\bmo\.?\b/gi, 'months');
  t = t.replace(/\bper\s*cent\b/gi, 'percent');
  t = t.replace(/\bpercent\s+percent\b/gi, 'percent');
  t = t.replace(/\s+/g, ' ').trim();
  if (t) {
    t = t.charAt(0).toUpperCase() + t.slice(1);
    if (!/[.!?]$/.test(t)) t += '.';
  }
  return t;
}

function shorten(s, max = 140) {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max).replace(/\s+\S*$/, '');
  return cut.replace(/[.!?]+$/,'') + '.';
}

function uniqueList(list) {
  const seen = new Set(); const out = [];
  for (const item of list) {
    const k = String(item || '').toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(item); }
  }
  return out;
}

function finalizeForUI(obj){
  const currentText = (document.querySelector('#petMessage')?.textContent || '').trim();
  const isAnalyzing = /analyzing/i.test(currentText);

  let headline = sanitizeLine(shorten(obj.headline || obj.message || '', 200));
  let advice   = (Array.isArray(obj.advice) ? obj.advice : [])
    .map(a => sanitizeLine(shorten(a, 200)))
    .filter(Boolean);

  advice = uniqueList(advice).slice(0, 3);

  const baseRaw = headline || (isAnalyzing ? '' : currentText);
  const base = sanitizeLine(shorten(baseRaw, 200));
  const bullets = advice.length ? advice.map(b => `• ${b}`).join('\n') : '';
  const message = bullets ? (base ? `${base}\n${bullets}` : bullets) : (base || '');

  return {
    state: toAllowedState(obj.state),
    health: clamp0to100(obj.health),
    message: message || 'All set.',
    headline,
    advice
  };
}

function toAllowedState(s){
  const allowed = ['ATROCIOUS','CRITICAL','STRUGGLING','SURVIVING','HEALTHY','THRIVING','FANTASTIC'];
  const up = String(s || '').toUpperCase();
  return allowed.includes(up) ? up : 'SURVIVING';
}
function clamp0to100(x){
  const n = Number(x);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/* ---------------- Legacy parse of raw candidates (fallback) -------------- */

function parseGeminiCandidates(payload) {
  try {
    const cand = payload?.candidates?.[0];
    if (!cand) return null;

    let text = '';
    if (Array.isArray(cand?.content?.parts)) {
      text = cand.content.parts.map(p => p?.text || '').join('');
    } else if (typeof cand?.text === 'string') {
      text = cand.text;
    } else if (typeof cand?.output === 'string') {
      text = cand.output;
    }

    const json = extractJson(text);
    if (!json) return null;

    json.state = toAllowedState(json.state);
    json.health = clamp0to100(json.health);
    if (!Array.isArray(json.advice)) json.advice = [];
    return json;
  } catch {
    return null;
  }
}

function extractJson(text) {
  if (!text) return null;
  text = String(text).replace(/```json|```/g, '').trim();
  try { return JSON.parse(text); } catch {}
  let start = text.indexOf('{');
  while (start !== -1) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const maybe = text.slice(start, i + 1);
          try { return JSON.parse(maybe); } catch { break; }
        }
      }
    }
    start = text.indexOf('{', start + 1);
  }
  return null;
}

// Optional global if script.js calls it directly
window.analyzeFinancialData = analyzeFinancialData; // server.js (CommonJS)