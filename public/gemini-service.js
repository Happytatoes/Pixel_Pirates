// public/gemini-service.js
// Works with normalized server responses or legacy raw candidates.
// Adds (not erases) new advice to the bubble via window.pennyShowMessage().
// Sends structured numeric inputs so the server can compute deterministically.
// Adds a timeout so the UI never hangs waiting for a response.
// Kid-mode style: full, simple sentences a 10-year-old can understand.
// No emojis, no parentheses, no colons, no symbols like %, ~, <=, >=, /, and no jargon.

const TIMEOUT_MS = 15000; // hard stop so UI never hangs

export async function analyzeFinancialData(data) {
  try {
    const prompt = buildFinancialPrompt(data);     // legacy servers read this
    const inputs = prepareInputs(data);            // deterministic servers can use this

    const { ok, json } = await postJson(
      '/analyze',
      { prompt, inputs, client: 'web-1.7' },
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

    // Path B: legacy raw candidates -> parse locally
    const parsed = parseGeminiCandidates(json);
    if (parsed) {
      const out = finalizeForUI(parsed);
      try { window.pennyShowMessage && window.pennyShowMessage(out.message); } catch {}
      return out;
    }

    // Path C: local deterministic fallback (math)
    const local = computeLocalDeterministic(inputs, data);
    const out = finalizeForUI(local);
    try { window.pennyShowMessage && window.pennyShowMessage(out.message); } catch {}
    return out;

  } catch (err) {
    console.error('analyzeFinancialData failed:', err);
    const local = computeLocalDeterministic(prepareInputs(data), data);
    const out = finalizeForUI(local);
    try { window.pennyShowMessage && window.pennyShowMessage(out.message); } catch {}
    return out;
  }
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
/* Prompt for legacy servers — kid friendly, game-y, no emoji/()/:/symbols    */
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
- Use simple phrases like money you bring in each month, money you spend each month, savings you already have, money you owe, money you invest each month, investment account total
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
- advice[2] = one simple goal for next week with a number that is easy to try

User data:
- monthly_income: ${numOrZero(data.income)}
- monthly_spending: ${numOrZero(data.spending)}
- total_savings: ${numOrZero(data.savings)}
- total_debt: ${numOrZero(data.debt)}
- monthly_investments: ${numOrZero(data.monthlyInvestments)}
- investment_balance: ${numOrZero(data.investmentBalance)}
`.trim();
}

/* --------------------------------- Helpers -------------------------------- */

function prepareInputs(d){
  return {
    monthly_income: Number(d.income) || 0,
    monthly_spending: Number(d.spending) || 0,
    total_savings: Number(d.savings) || 0,
    total_debt: Number(d.debt) || 0,
    monthly_investments: Number(d.monthlyInvestments) || 0,
    investment_balance: Number(d.investmentBalance) || 0,

    // Optional trend/shock inputs if you track them between calls:
    shortEmaPrev: Number(d.shortEmaPrev ?? NaN),
    longEmaPrev:  Number(d.longEmaPrev  ?? NaN),
    spendEmaPrev: Number(d.spendEmaPrev ?? NaN),
    spendStdDev:  Number(d.spendStdDev  ?? NaN),
    fVolatility:  Number(d.fVolatility  ?? NaN)
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
  t = t.replace(/\bspend(?:ing)?\s+share\s+(\d+(?:\.\d+)?)\s+percent\b/i, 'you spend $1 percent of your money');
  t = t.replace(/\bshare\s+(\d+(?:\.\d+)?)\s+percent\b/i, 'the share is $1 percent');
  t = t.replace(/\bmonths of savings\s+(\d+(?:\.\d+)?)\s+months\b/i, 'you have $1 months of savings');
  t = t.replace(/\bdebt to income\s+(\d+(?:\.\d+)?)\s+percent\b/i, 'your debt is $1 percent of your income');
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

/* ---------------- Local deterministic fallback (trend-aware math) ---------- */

function computeLocalDeterministic(inputs) {
  const m = localCoreMetrics(inputs);
  const subs = localSubscores(m);
  const F = 0.35*subs.B + 0.25*subs.H + 0.25*subs.R + 0.15*subs.L;

  const hasShort = Number.isFinite(inputs.shortEmaPrev);
  const hasLong  = Number.isFinite(inputs.longEmaPrev);
  const E_short = hasShort ? (0.5*F + 0.5*inputs.shortEmaPrev) : NaN;
  const E_long  = hasLong  ? (0.1*F + 0.9*inputs.longEmaPrev)   : NaN;
  const Delta   = (hasShort && hasLong) ? (E_short - E_long) : 0;
  const T       = Math.tanh(Delta / 0.10);

  const hasSpendEma = Number.isFinite(inputs.spendEmaPrev);
  const hasStd = Number.isFinite(inputs.spendStdDev) && inputs.spendStdDev > 0;
  let P = 0;
  if (hasSpendEma && hasStd) {
    const spendEma = 0.3*inputs.monthly_spending + 0.7*inputs.spendEmaPrev;
    const z = (inputs.monthly_spending - spendEma) / inputs.spendStdDev;
    P = clamp01((z - 1.5) / 3.0);
  }

  let Pprime = P;
  if (T >= 0) Pprime = P * (1 - 0.7*T); else Pprime = P * (1 + 0.7*Math.abs(T));
  Pprime = clamp01(Pprime);

  const U = Number.isFinite(inputs.fVolatility) ? Math.exp(- (inputs.fVolatility / 0.15)) : 1;

  const H_now  = 100 * clamp01(F + 0.40*T + 0.20*U - 0.30*Pprime);
  const F_proj = clamp01(F + 0.60*T - 0.50*Pprime);
  const H_proj = 100 * F_proj;

  const state = stateFromH(H_now);
  const headline = sanitizeLine(buildKidHeadline(state, H_now, m));
  const advice = [
    sanitizeLine(buildKidPositive(m)),
    sanitizeLine(buildKidFix(m)),
    sanitizeLine(buildKidGoal(m, inputs))
  ].map(s => shorten(s, 200));

  return {
    state,
    health: clamp0to100(H_now),
    headline,
    advice,
    currentHappiness: clamp0to100(H_now),
    projectedHappiness: clamp0to100(H_proj)
  };
}

function localCoreMetrics(inp){
  const inc  = +inp.monthly_income      || 0;
  const sp   = +inp.monthly_spending    || 0;
  const sav  = +inp.total_savings       || 0;
  const debt = +inp.total_debt          || 0;
  const invM = +inp.monthly_investments || 0;
  const invB = +inp.investment_balance  || 0;

  const u  = inc > 0 ? sp / inc : Infinity;
  const h  = inc > 0 ? invM / inc : 0;
  const m  = sp > 0 ? sav / sp : (sav > 0 ? 99.999 : 0);
  const A  = sav + invB;
  const ell = A > 0 ? debt / A : Infinity;

  return { inc, sp, sav, debt, invM, invB, u, h, m, ell };
}

function localSubscores(m){
  const sigma = (x) => 1 / (1 + Math.exp(-x));
  const B = sigma((0.80 - m.u) / 0.10);
  const H = sigma((m.h - 0.10) / 0.05);
  const R = clamp01(m.m / 6.0);
  const L = sigma((1 - m.ell) / 0.50);
  return { B, H, R, L };
}

function clamp01(x){ return Math.min(1, Math.max(0, x)); }

function stateFromH(h){
  if (h < 15) return 'ATROCIOUS';
  if (h < 30) return 'CRITICAL';
  if (h < 45) return 'STRUGGLING';
  if (h < 60) return 'SURVIVING';
  if (h < 75) return 'HEALTHY';
  if (h < 90) return 'THRIVING';
  return 'FANTASTIC';
}

/* ------------------------ Kid-friendly sentence builders ------------------- */

function dollars(n){ n = Math.max(0, Math.round(n)); return `${n} dollars`; }
function percentWords(x){ return `${Math.round(x*100)} percent`; }
function monthsWords(x){ return `${(Math.round(x*10)/10).toFixed(1)} months`; }

function buildKidHeadline(state, h){
  const hInt = Math.round(h);
  if (state === 'FANTASTIC') return `Your pet is very strong with a score of ${hInt} points.`;
  if (state === 'THRIVING')  return `Your pet is doing very well with a score of ${hInt} points.`;
  if (state === 'HEALTHY')   return `Your pet is steady with a score of ${hInt} points.`;
  if (state === 'SURVIVING') return `Your pet is okay with a score of ${hInt} points.`;
  if (state === 'STRUGGLING')return `Your pet feels tight with a score of ${hInt} points.`;
  if (state === 'CRITICAL')  return `Your pet needs care with a score of ${hInt} points.`;
  return `Your pet needs help now with a score of ${hInt} points.`;
}

function buildKidPositive(m){
  if (m.u <= 0.80) return `You spend ${percentWords(m.u)} of your money which is under the goal.`;
  if (m.m >= 3.0)  return `You have ${monthsWords(m.m)} of savings which is a strong base.`;
  if (m.h >= 0.10) return `You invest ${percentWords(m.h)} of your income which is on track.`;
  return `You took a good step that helps this week.`;
}

function buildKidFix(m){
  if (m.u > 0.90) {
    const extra = Math.max(0, Math.round((m.u - 0.90) * 100));
    return `Cut spending by about ${extra} percent to reach the goal.`;
  }
  if (m.h < 0.10) return `Raise investing to ten percent because you are at ${percentWords(m.h)} now.`;
  if (m.m < 2.0) {
    const need = Math.max(0, Math.round((2.0 - m.m) * (m.sp || 0)));
    return `Add ${dollars(need)} to savings to build two months.`;
  }
  return `Pick one small bill and lower it by ${10} percent this week.`;
}

function buildKidGoal(m, inputs){
  if (m.h < 0.10 && m.inc > 0) {
    const weekly = Math.max(1, Math.ceil((m.inc * 0.10) / 4));
    return `Send ${dollars(weekly)} each week to your investing account.`;
  }
  const cap = Math.max(1, Math.ceil((m.inc * 0.80 - m.sp)));
  return `Keep daily spending low so you end the month under eighty percent which is a cap of ${dollars(cap)}.`;
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
window.analyzeFinancialData = analyzeFinancialData;
