// server.js (CommonJS)
// Deterministic metrics/state/health on server; Gemini only supplies headline + advice.
// Uses v1beta + JSON mode + responseSchema. Returns:
// { state, health, message, headline, advice }

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
dotenv.config();

// Node 18+ has global fetch. For older Node, install node-fetch and uncomment:
// const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.get('/favicon.ico', (req, res) => res.status(204).end());

/* ------------------------------ Deterministic ------------------------------ */

const ALLOWED_STATES = [
  'FLATLINED','CRITICAL','STRUGGLING','SURVIVING','HEALTHY','THRIVING','LEGENDARY'
];

const toAllowedState = s => (ALLOWED_STATES.includes(String(s).toUpperCase()) ? String(s).toUpperCase() : 'SURVIVING');
const clamp0to100   = x => Number.isFinite(+x) ? Math.max(0, Math.min(100, Math.round(+x))) : 50;

function computeMetrics(inputs) {
  const inc  = +inputs.monthly_income      || 0;
  const sp   = +inputs.monthly_spending    || 0;
  const sav  = +inputs.total_savings       || 0;
  const debt = +inputs.total_debt          || 0;
  const invM = +inputs.monthly_investments || 0;

  // exact math (no rounding for decisions)
  const budget_ratio  = inc > 0 ? sp / inc : Number.POSITIVE_INFINITY;
  const runway_months = sp > 0 ? sav / sp : (sav > 0 ? 99.999 : 0);
  const invest_rate   = inc > 0 ? invM / inc : 0;
  const dti           = inc > 0 ? debt / inc : Number.POSITIVE_INFINITY;

  return { budget_ratio, runway_months, invest_rate, dti, inc, sp, sav, debt };
}

function pickState(m) {
  if (m.inc <= 0 || m.budget_ratio >= 1.5 || m.runway_months < 0.5) return 'FLATLINED';
  if (m.budget_ratio > 1.10 || m.runway_months < 1.0 || m.dti > 1.20) return 'CRITICAL';
  if ((m.budget_ratio > 0.90 && m.budget_ratio <= 1.10) || (m.runway_months >= 1.0 && m.runway_months < 2.0) || (m.dti > 0.60 && m.dti <= 1.20)) return 'STRUGGLING';
  if ((m.budget_ratio > 0.80 && m.budget_ratio <= 0.90) || (m.runway_months >= 2.0 && m.runway_months < 3.0) || (m.invest_rate >= 0.05 && m.invest_rate < 0.10)) return 'SURVIVING';
  if (m.budget_ratio <= 0.80 && (m.runway_months >= 3.0 && m.runway_months <= 6.0) && m.invest_rate >= 0.10 && m.dti <= 0.60) return 'HEALTHY';
  if (m.budget_ratio <= 0.70 && (m.runway_months > 6.0 && m.runway_months <= 12.0) && m.invest_rate >= 0.12 && m.dti <= 0.40) return 'THRIVING';
  if (m.budget_ratio <= 0.60 && m.runway_months > 12.0 && m.invest_rate >= 0.15 && m.dti <= 0.20) return 'LEGENDARY';
  return 'SURVIVING';
}

function computeHealth(m) {
  let h = 50;
  // budget
  if (m.budget_ratio <= 0.80) h += 15;
  else if (m.budget_ratio <= 0.90) h += 5;
  else if (m.budget_ratio <= 1.10) h -= 10;
  else h -= 25;
  if (m.budget_ratio >= 1.50) h -= 15; // extra penalty to match flatline

  // runway
  if (m.runway_months >= 6) h += 20;
  else if (m.runway_months >= 3) h += 10;
  else if (m.runway_months >= 2) h += 5;
  else if (m.runway_months >= 1) h -= 10;
  else { h -= 25; if (m.runway_months < 0.5) h -= 10; }

  // investing
  if (m.invest_rate >= 0.12) h += 10;
  else if (m.invest_rate >= 0.10) h += 5;
  else if (m.invest_rate >= 0.05) h += 2;

  // debt
  if (m.dti <= 0.40) h += 10;
  else if (m.dti <= 0.60) h += 5;
  else if (m.dti <= 1.20) h -= 10;
  else h -= 20;

  return clamp0to100(h);
}

const normalizeAdvice = arr =>
  Array.isArray(arr) ? arr.map(s => String(s||'').trim()).filter(Boolean).slice(0,3) : [];

const makeSpeechMessage = (headline, advice3) =>
  `${headline || ''}${advice3.length ? '\n' + advice3.map(b => '• ' + b).join('\n') : ''}`.trim();

/* ---------------------------------- Route ----------------------------------- */

app.post('/analyze', async (req, res) => {
  try {
    // Expect structured numbers from client; fallback to 0 if missing
    const inputs = req.body.inputs || {};
    const m = computeMetrics(inputs);
    const state = pickState(m);
    const health = computeHealth(m);

    // Short, strict prompt: Gemini ONLY crafts headline + 3 bullets (emojis welcome)
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing GEMINI_API_KEY in .env' });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const responseSchema = {
      type: 'OBJECT',
      properties: {
        headline: { type: 'STRING' }, // emojis allowed in strings
        advice: { type: 'ARRAY', items: { type: 'STRING' }, minItems: 3, maxItems: 3 }
      },
      required: ['headline','advice'],
      propertyOrdering: ['headline','advice']
    };

    const coachPrompt =
      `You are a concise financial coach. Use a fun, supportive tone with 1–2 emojis per line.\n` +
      `Given metrics (raw numbers):\n` +
      JSON.stringify({
        budget_ratio: +m.budget_ratio.toFixed(3),
        runway_months: +m.runway_months.toFixed(3),
        invest_rate: +m.invest_rate.toFixed(3),
        dti: +m.dti.toFixed(3),
        state,
        health
      }) +
      `\nReturn JSON ONLY:\n` +
      `{\n  "headline": "<<=90 chars, can include emojis>",\n` +
      `  "advice": ["Good: ...", "Fix: ...", "Goal (next week): ..."]\n}\n` +
      `Rules:\n- Tie each bullet to the numbers (include one number in parentheses).\n- No code fences, no extra keys.\n- Max ~90 chars per line.`;

    const body = {
      contents: [{ parts: [{ text: coachPrompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0.3,
        maxOutputTokens: 140
      }
    };

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await r.json().catch(() => ({}));

    // If API error OR MAX_TOKENS OR empty text → fallback immediately
    const finish = data?.candidates?.[0]?.finishReason;
    const cand   = data?.candidates?.[0];
    let text     = '';

    if (!r.ok || finish === 'MAX_TOKENS') {
      const fb = buildLocalAdvice(m, state);
      const msg = makeSpeechMessage(fb.headline, fb.advice);
      return res.status(200).json({ state, health, message: msg, ...fb });
    }

    if (Array.isArray(cand?.content?.parts)) text = cand.content.parts.map(p => p?.text || '').join('');
    else if (typeof cand?.text === 'string') text = cand.text;

    let llmObj;
    try { llmObj = JSON.parse((text||'').trim() || '{}'); }
    catch { llmObj = {}; }

    const headline = (llmObj.headline || '').trim();
    const advice   = normalizeAdvice(llmObj.advice);

    // If Gemini returned nothing usable → fallback
    if (!headline && advice.length === 0) {
      const fb = buildLocalAdvice(m, state);
      const msg = makeSpeechMessage(fb.headline, fb.advice);
      return res.status(200).json({ state, health, message: msg, ...fb });
    }

    const message  = makeSpeechMessage(headline, advice);
    return res.json({ state, health, message, headline, advice });

  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

/* -------------------------- Local advice fallback --------------------------- */

function buildLocalAdvice(m, state) {
  const headline =
    state === 'LEGENDARY' ? 'Legend status — systems humming. 🚀' :
    state === 'THRIVING'  ? 'Strong trajectory — keep compounding. 📈' :
    state === 'HEALTHY'   ? 'On plan — maintain discipline. ✅' :
    state === 'SURVIVING' ? 'Stable, but tighten a few screws. 🛠️' :
    state === 'STRUGGLING'? 'Pressure building — quick wins needed. ⚠️' :
    state === 'CRITICAL'  ? 'Critical — address cash risk now. 🆘' :
                            'Flatlined — emergency mode. 💀';

  const pct = x => isFinite(x) ? `${Math.round(x*100)}%` : '∞';
  const one = (m.budget_ratio <= 0.8)
    ? `Good: Spend ratio ${pct(m.budget_ratio)} (≤80%). 👍`
    : (m.runway_months >= 3)
      ? `Good: Runway ${m.runway_months.toFixed(1)} mo (≥3). 💡`
      : (m.invest_rate >= 0.10)
        ? `Good: Investing ${pct(m.invest_rate)} (≥10%). 📈`
        : (m.dti <= 0.60)
          ? `Good: DTI ${pct(m.dti)} (≤60%). ✅`
          : `Good: Clear starting point for improvement. ⭐`;

  const two = (m.budget_ratio > 0.9)
    ? `Fix: Trim spend ~${Math.ceil((m.budget_ratio-0.9)*100)}% to reach ≤90%. ✂️`
    : (m.runway_months < 2)
      ? `Fix: Boost savings to 2 mo runway (now ${m.runway_months.toFixed(1)}). 🏦`
      : (m.invest_rate < 0.10)
        ? `Fix: Raise invest rate to 10% (now ${pct(m.invest_rate)}). 💸`
        : (m.dti > 1.2)
          ? `Fix: Pay down debt; DTI ${pct(m.dti)} > 120%. 📉`
          : `Fix: Pick one category to cut this week. 📝`;

  const weekly = Math.max(1, Math.ceil(((m.inc||0)*0.10)/4));
  const three = (m.invest_rate < 0.10)
    ? `Goal (next week): auto-move ${weekly} to investing. 🗓️`
    : (m.runway_months < 3)
      ? `Goal (next week): save ${Math.ceil((m.sp||0)*0.1)} to build runway. ⛳`
      : `Goal (next week): track spend daily; keep ratio ≤80%. 🧭`;

  return { headline, advice: [one, two, three] };
}

/* --------------------------------- Boot ------------------------------------ */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Penny server at http://localhost:${PORT}`);
  console.log('Open http://localhost:3000 (do NOT use file://)');
});
