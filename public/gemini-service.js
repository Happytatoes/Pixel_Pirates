// public/gemini-service.js
// Works with normalized server responses or legacy raw candidates.
// Adds (not erases) new advice to the bubble.
// Sends structured numeric inputs so the server can compute deterministically.
// Adds a timeout so the UI never hangs waiting for a response.
// Style enforcement: no emojis, no parentheses, no colons; full sentences in plain English.

const TIMEOUT_MS = 15000; // hard stop so UI never hangs

export async function analyzeFinancialData(data) {
  try {
    const prompt = buildFinancialPrompt(data);     // legacy servers
    const inputs = prepareInputs(data);            // deterministic server

    const { ok, json } = await postJson(
      '/analyze',
      { prompt, inputs, client: 'web-1.5' },
      TIMEOUT_MS
    );

    if (!ok) {
      const msg = stringifyErr(json) || 'Server error';
      throw new Error(msg);
    }

    // Path A: normalized JSON from server
    if (looksNormalized(json)) {
      return finalizeForUI(json);
    }

    // Path B: legacy raw candidates
    const parsed = parseGeminiCandidates(json);
    if (parsed) return finalizeForUI(parsed);

    // Path C: local fallback
    const local = computeLocalFallback(inputs);
    return finalizeForUI(local);

  } catch (err) {
    console.error('analyzeFinancialData failed:', err);
    const local = computeLocalFallback(prepareInputs(data));
    return finalizeForUI(local);
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
/* Prompt for legacy servers — plain full sentences, no emoji/()/:            */
/* -------------------------------------------------------------------------- */

function buildFinancialPrompt(data) {
  return `
You are Penny, a kind money helper. Explain like you are talking to a ten year old.

Style rules:
- No emojis
- No parentheses
- No colons
- Use short full sentences in plain English
- Do not use hard words like DTI, ratio, runway, leverage, liquidity, cash flow
- Use simple phrases like: money you bring in each month, money you spend each month, savings you already have, money you owe, money you invest each month, investment account total
- Write numbers clearly with words like percent, months, dollars
- Each sentence should include one clear number

Return JSON ONLY in this exact shape (no extra keys, no code fences):
{
  "state": "FLATLINED|CRITICAL|STRUGGLING|SURVIVING|HEALTHY|THRIVING|LEGENDARY",
  "health": 0,
  "headline": "string",
  "advice": ["string","string","string"]
}

What to write:
- headline = one friendly sentence that sums up how they are doing
- advice[0] = one positive sentence about a clear strength with a number
- advice[1] = one helpful fix with a number
- advice[2] = one simple goal for next week with a number

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
  const allowed = ['FLATLINED','CRITICAL','STRUGGLING','SURVIVING','HEALTHY','THRIVING','LEGENDARY'];
  return (
    obj &&
    typeof obj.health === 'number' &&
    (typeof obj.message === 'string' || typeof obj.headline === 'string') &&
    allowed.includes(String(obj.state).toUpperCase())
  );
}

/* ----------------------------- Text sanitizing ----------------------------- */
// Remove emojis, parentheses, and colons; expand '%' to ' percent', 'mo' to 'months'.
// Keep periods and ensure full sentences end with a period.
function sanitizeLine(s) {
  let t = String(s || '');

  // Remove emoji-like ranges (misc symbols + SMP pictographs)
  t = t.replace(/[\u2600-\u26FF\u{1F300}-\u{1FAFF}]/gu, '');

  // Remove parentheses and colons
  t = t.replace(/[():]/g, '');

  // Expand common shorthand
  t = t.replace(/%/g, ' percent');
  t = t.replace(/\bmo\b/gi, 'months');
  t = t.replace(/\bmo\./gi, 'months');

  // Normalize spaces
  t = t.replace(/\s+/g, ' ').trim();

  // Ensure a period at the end for full sentence feel (unless already ends with . ! ?)
  if (!/[.!?]$/.test(t) && t.length) t += '.';

  return t;
}

function shorten(s, max = 96) {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max).replace(/\s+\S*$/, ''); // cut at last whole word
  return cut.replace(/[.!?]+$/,'') + '.';
}

function uniqueList(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const k = item.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(item); }
  }
  return out;
}

function finalizeForUI(obj){
  // Ignore the “analyzing” placeholder if it is still on screen
  const currentText = (document.querySelector('#petMessage')?.textContent || '').trim();
  const isAnalyzing = /analyzing/i.test(currentText);

  // Sanitize and simplify headline + bullets
  let headline = sanitizeLine(shorten(obj.headline || obj.message || '', 96));
  let advice   = (Array.isArray(obj.advice) ? obj.advice : [])
    .map(a => sanitizeLine(shorten(a)))
    .filter(Boolean);

  advice = uniqueList(advice).slice(0, 3);

  // Base: prefer new headline; otherwise keep previous unless it was the analyzing line
  const baseRaw = headline || (isAnalyzing ? '' : currentText);
  const base = sanitizeLine(shorten(baseRaw, 96));
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
  const allowed = ['FLATLINED','CRITICAL','STRUGGLING','SURVIVING','HEALTHY','THRIVING','LEGENDARY'];
  const up = String(s || '').toUpperCase();
  return allowed.includes(up) ? up : 'SURVIVING';
}
function clamp0to100(x){
  const n = Number(x);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/* ---------------- Local deterministic fallback (client-side) --------------- */
// Generates simple, clear, emoji-free sentences if server/LLM fails.
function computeLocalFallback(inputs){
  const m = localMetrics(inputs);
  const state = localPickState(m);
  const health = localHealth(m);

  const headline =
    state === 'LEGENDARY' ? 'Legend energy. Keep going.' :
    state === 'THRIVING'  ? 'Strong path. Stay steady.'   :
    state === 'HEALTHY'   ? 'Solid footing. Nice work.'    :
    state === 'SURVIVING' ? 'We are okay. Let’s tighten a bit.'  :
    state === 'STRUGGLING'? 'Pressure is building. Quick wins help.' :
    state === 'CRITICAL'  ? 'This is critical. Protect cash now.'  :
                            'Flatlined. Emergency mode.';

  const pct = x => isFinite(x) ? `${Math.round(x*100)} percent` : 'infinite';
  const advice = [
    (m.budget_ratio <= 0.8)
      ? `Your spending is ${pct(m.budget_ratio)} which is under the target.`
      : (m.runway_months >= 3)
        ? `You have ${m.runway_months.toFixed(1)} months of runway which is a good base.`
        : `You picked a clear place to start and that is good.`,
    (m.budget_ratio > 0.9)
      ? `Trim spending by about ${Math.ceil((m.budget_ratio-0.9)*100)} percent to reach ninety percent.`
      : (m.invest_rate < 0.10)
        ? `Raise investing to ten percent you are at ${pct(m.invest_rate)} now.`
        : `Choose one category to cut this week and stick to it.`,
    (m.invest_rate < 0.10)
      ? `Set an automatic transfer of ${Math.max(1, Math.ceil(((m.inc||0)*0.10)/4))} each week.`
      : `Track spending daily and keep the ratio at or below eighty percent.`
  ].map(sanitizeLine).map(s => shorten(s));

  return { state: localPickState(m), health, headline: sanitizeLine(headline), advice, message: '' };
}

function localMetrics(inp){
  const inc  = +inp.monthly_income      || 0;
  const sp   = +inp.monthly_spending    || 0;
  const sav  = +inp.total_savings       || 0;
  const debt = +inp.total_debt          || 0;
  const invM = +inp.monthly_investments || 0;
  const budget_ratio  = inc > 0 ? sp / inc : Number.POSITIVE_INFINITY;
  const runway_months = sp > 0 ? sav / sp : (sav > 0 ? 99.999 : 0);
  const invest_rate   = inc > 0 ? invM / inc : 0;
  const dti           = inc > 0 ? debt / inc : Number.POSITIVE_INFINITY;
  return { budget_ratio, runway_months, invest_rate, dti, inc, sp, sav, debt };
}

function localPickState(m){
  if (m.inc <= 0 || m.budget_ratio >= 1.5 || m.runway_months < 0.5) return 'FLATLINED';
  if (m.budget_ratio > 1.10 || m.runway_months < 1.0 || m.dti > 1.20) return 'CRITICAL';
  if ((m.budget_ratio > 0.90 && m.budget_ratio <= 1.10) || (m.runway_months >= 1.0 && m.runway_months < 2.0) || (m.dti > 0.60 && m.dti <= 1.20)) return 'STRUGGLING';
  if ((m.budget_ratio > 0.80 && m.budget_ratio <= 0.90) || (m.runway_months >= 2.0 && m.runway_months < 3.0) || (m.invest_rate >= 0.05 && m.invest_rate < 0.10)) return 'SURVIVING';
  if (m.budget_ratio <= 0.80 && (m.runway_months >= 3.0 && m.runway_months <= 6.0) && m.invest_rate >= 0.10 && m.dti <= 0.60) return 'HEALTHY';
  if (m.budget_ratio <= 0.70 && (m.runway_months > 6.0 && m.runway_months <= 12.0) && m.invest_rate >= 0.12 && m.dti <= 0.40) return 'THRIVING';
  if (m.budget_ratio <= 0.60 && m.runway_months > 12.0 && m.invest_rate >= 0.15 && m.dti <= 0.20) return 'LEGENDARY';
  return 'SURVIVING';
}

function localHealth(m){
  let h = 50;
  if (m.budget_ratio <= 0.80) h += 15;
  else if (m.budget_ratio <= 0.90) h += 5;
  else if (m.budget_ratio <= 1.10) h -= 10;
  else h -= 25;
  if (m.budget_ratio >= 1.50) h -= 15;

  if (m.runway_months >= 6) h += 20;
  else if (m.runway_months >= 3) h += 10;
  else if (m.runway_months >= 2) h += 5;
  else if (m.runway_months >= 1) h -= 10;
  else { h -= 25; if (m.runway_months < 0.5) h -= 10; }

  if (m.invest_rate >= 0.12) h += 10;
  else if (m.invest_rate >= 0.10) h += 5;
  else if (m.invest_rate >= 0.05) h += 2;

  if (m.dti <= 0.40) h += 10;
  else if (m.dti <= 0.60) h += 5;
  else if (m.dti <= 1.20) h -= 10;
  else h -= 20;

  return clamp0to100(h);
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
  // Fallback: first balanced {...}
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
