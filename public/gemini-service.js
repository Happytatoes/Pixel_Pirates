// public/gemini-service.js
// Works with normalized server responses or legacy raw candidates.
// Adds (not erases) new advice to the bubble.
// Sends structured numeric inputs so the server can compute deterministically.
// Adds a timeout so the UI never hangs waiting for a response.

const TIMEOUT_MS = 15000; // hard stop so UI never hangs

export async function analyzeFinancialData(data) {
  try {
    const prompt = buildFinancialPrompt(data);     // legacy servers
    const inputs = prepareInputs(data);            // deterministic server

    const { ok, json } = await postJson('/analyze', { prompt, inputs, client: 'web-1.3' }, TIMEOUT_MS);
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

    // Path C: local fallback (avoid SURVIVING/50 when server gives nothing)
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
/* Prompt for legacy servers (emojis allowed in strings)                      */
/* -------------------------------------------------------------------------- */

function buildFinancialPrompt(data) {
  return `
You are Penny, a friendly but expert financial coach. Analyze the user's finances and be concise but specific.

FIRST, compute these metrics (exact math, show 1 decimal if needed):
- budget_ratio = monthly_spending / monthly_income
- runway_months = total_savings / max(monthly_spending, 1)
- invest_rate = monthly_investments / monthly_income
- dti = total_debt / max(monthly_income, 1)

THEN, choose a pet STATE by these rules (choose the most severe that applies):
- FLATLINED: income <= 0, OR budget_ratio >= 1.50, OR runway_months < 0.5
- CRITICAL: budget_ratio > 1.10, OR runway_months < 1.0, OR dti > 1.20
- STRUGGLING: 0.90 < budget_ratio <= 1.10, OR 1.0 <= runway_months < 2.0, OR 0.60 < dti <= 1.20
- SURVIVING: 0.80 < budget_ratio <= 0.90, OR 2.0 <= runway_months < 3.0, OR 0.05 <= invest_rate < 0.10
- HEALTHY: budget_ratio <= 0.80 AND 3.0 <= runway_months <= 6.0 AND invest_rate >= 0.10 AND dti <= 0.60
- THRIVING: budget_ratio <= 0.70 AND 6.0 < runway_months <= 12.0 AND invest_rate >= 0.12 AND dti <= 0.40
- LEGENDARY: budget_ratio <= 0.60 AND runway_months > 12.0 AND invest_rate >= 0.15 AND dti <= 0.20

Compute HEALTH (0–100) as:
- Start at 50.
- Budget: +15 if <=0.80; +5 if 0.80–0.90; -10 if 0.90–1.10; -25 if >1.10; -15 extra if >=1.50.
- Runway: +20 if >=6; +10 if 3–6; +5 if 2–3; -10 if 1–2; -25 if <1; -10 extra if <0.5.
- Investing: +10 if >=0.12; +5 if 0.10–0.12; +2 if 0.05–0.10.
- Debt: +10 if <=0.40; +5 if 0.40–0.60; -10 if 0.60–1.20; -20 if >1.20.
- Clamp final health to [0,100].

Return:
- headline: one friendly one-liner (≤90 chars, emojis welcome).
- advice: EXACTLY 3 bullets with clear labels:
  1) "Good: ..." (one concrete strength + number),
  2) "Fix: ..." (highest-impact fix + number),
  3) "Goal (next week): ..." (one actionable step + number).
Avoid generic tips.

RESPOND WITH JSON ONLY. NO code fences. EXACT shape:

{
  "state": "FLATLINED|CRITICAL|STRUGGLING|SURVIVING|HEALTHY|THRIVING|LEGENDARY",
  "health": 0,
  "headline": "string",
  "advice": ["string","string","string"]
}

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

function finalizeForUI(obj){
  // Pull the current bubble text; ignore it if it's the analyzing line.
  const currentText = (document.querySelector('#petMessage')?.textContent || '').trim();
  const isAnalyzing = /analyzing/i.test(currentText);

  const headline = (obj.headline || obj.message || '').trim();
  const advice = (Array.isArray(obj.advice) ? obj.advice : [])
    .map(s => String(s || '').trim())
    .filter(Boolean);

  // base: prefer new headline; otherwise keep previous unless it's the analyzing line
  const base = headline || (isAnalyzing ? '' : currentText);
  const bullets = advice.length ? advice.map(b => `• ${b}`).join('\n') : '';
  const message = bullets ? (base ? `${base}\n${bullets}` : bullets) : (base || '');

  return {
    state: toAllowedState(obj.state),
    health: clamp0to100(obj.health),
    message: message.trim() || headline || '✅ Analysis complete.',
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

function computeLocalFallback(inputs){
  const m = localMetrics(inputs);
  const state = localPickState(m);
  const health = localHealth(m);

  // Friendly fallback with emojis
  const headline =
    state === 'LEGENDARY' ? 'Legend status — systems humming. 🚀' :
    state === 'THRIVING'  ? 'Strong trajectory — keep compounding. 📈' :
    state === 'HEALTHY'   ? 'On plan — maintain discipline. ✅' :
    state === 'SURVIVING' ? 'Stable, but tighten a few screws. 🛠️' :
    state === 'STRUGGLING'? 'Pressure building — quick wins needed. ⚠️' :
    state === 'CRITICAL'  ? 'Critical — address cash risk now. 🆘' :
                            'Flatlined — emergency mode. 💀';

  const pct = x => isFinite(x) ? `${Math.round(x*100)}%` : '∞';
  const advice = [
    (m.budget_ratio <= 0.8)
      ? `Good: Spend ratio ${pct(m.budget_ratio)} (≤80%). 👍`
      : (m.runway_months >= 3)
        ? `Good: Runway ${m.runway_months.toFixed(1)} mo (≥3). 💡`
        : `Good: Clear improvement starting point. ⭐`,
    (m.budget_ratio > 0.9)
      ? `Fix: Trim spend ~${Math.ceil((m.budget_ratio-0.9)*100)}% to reach ≤90%. ✂️`
      : (m.invest_rate < 0.10)
        ? `Fix: Raise invest rate to 10% (now ${pct(m.invest_rate)}). 💸`
        : `Fix: Pick one category to cut this week. 📝`,
    (m.invest_rate < 0.10)
      ? `Goal (next week): auto-move ${Math.max(1, Math.ceil(((m.inc||0)*0.10)/4))}/wk to investing. 🗓️`
      : `Goal (next week): track spend daily; keep ratio ≤80%. 🧭`
  ];

  return { state: localPickState(m), health, headline, advice, message: '' };
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
