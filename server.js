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
  'ATROCIOUS','CRITICAL','STRUGGLING','SURVIVING','HEALTHY','THRIVING','FANTASTIC'
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
  if (m.inc <= 0 || m.budget_ratio >= 1.5 || m.runway_months < 0.5) return 'ATROCIOUS';
  if (m.budget_ratio > 1.10 || m.runway_months < 1.0 || m.dti > 1.20) return 'CRITICAL';
  if ((m.budget_ratio > 0.90 && m.budget_ratio <= 1.10) || (m.runway_months >= 1.0 && m.runway_months < 2.0) || (m.dti > 0.60 && m.dti <= 1.20)) return 'STRUGGLING';
  if ((m.budget_ratio > 0.80 && m.budget_ratio <= 0.90) || (m.runway_months >= 2.0 && m.runway_months < 3.0) || (m.invest_rate >= 0.05 && m.invest_rate < 0.10)) return 'SURVIVING';
  if (m.budget_ratio <= 0.80 && (m.runway_months >= 3.0 && m.runway_months <= 6.0) && m.invest_rate >= 0.10 && m.dti <= 0.60) return 'HEALTHY';
  if (m.budget_ratio <= 0.70 && (m.runway_months > 6.0 && m.runway_months <= 12.0) && m.invest_rate >= 0.12 && m.dti <= 0.40) return 'THRIVING';
  if (m.budget_ratio <= 0.60 && m.runway_months > 12.0 && m.invest_rate >= 0.15 && m.dti <= 0.20) return 'FANTASTIC';
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

    // pre-format numbers to reduce model work
    const ctx = {
      budget_ratio_pct: Number.isFinite(m.budget_ratio) ? Math.round(m.budget_ratio*100) : '∞',
      runway_months_1d: +m.runway_months.toFixed(1),
      invest_rate_pct:  Math.round(m.invest_rate*100),
      dti_pct:          Number.isFinite(m.dti) ? Math.round(m.dti*100) : '∞',
      state,
      health
    };

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing GEMINI_API_KEY in .env' });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const responseSchema = {
      type: 'OBJECT',
      properties: {
        headline: { type: 'STRING' },         // emojis OK
        advice:   { type: 'ARRAY', items: { type: 'STRING' }, minItems: 3, maxItems: 3 }
      },
      required: ['headline','advice'],
      propertyOrdering: ['headline','advice']
    };

    // === NEW: Short + cute prompt (1 emoji per line, plain words) ===
    const coachPrompt =
      `You are a concise, friendly money coach. Keep it simple and cute.\n` +
      `Use 1 emoji per line. Max ~60 chars per bullet. No hashtags.\n` +
      `Use the numbers I give you in parentheses.\n\n` +
      `Numbers:\n` + JSON.stringify(ctx) + `\n\n` +
      `Return JSON ONLY (no code fences):\n` +
      `{\n  "headline": "<<=80 chars, can include 1 emoji>",\n` +
      `  "advice": [\n` +
      `    "Good: <strength tied to a number>",\n` +
      `    "Fix: <highest-impact fix tied to a number>",\n` +
      `    "Goal (next week): <one tiny step with a number>"\n` +
      `  ]\n}\n`;

    const body = {
      contents: [{ parts: [{ text: coachPrompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0.3,
        maxOutputTokens: 120
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

/* -------------------------------------------------------------------------- */
/*                              Nessie API proxy                              */
/*
 * If you provide a NESSIE_API_KEY and NESSIE_CUSTOMER_ID in your .env file the
 * server will fetch your mock banking data from Capital One’s hackathon API.
 * It aggregates the current balance across all accounts as well as deposits,
 * purchases and withdrawals over the last 30 days.  Those aggregates are used
 * to prefill the client‑side form so users don’t have to manually enter
 * monthly earnings or spending.  All network calls are proxied through the
 * backend so your API key remains hidden from the browser.
 */

app.get('/nessie-data', async (req, res) => {
  const apiKey = process.env.NESSIE_API_KEY;
  const customerId = process.env.NESSIE_CUSTOMER_ID;
  if (!apiKey || !customerId) {
    return res.status(400).json({ error: 'NESSIE_API_KEY and NESSIE_CUSTOMER_ID must be set in .env' });
  }
  // Base URL for the Nessie API.  We use https by default; the port is
  // optional because the API is served over standard ports.
  const baseUrl = 'https://api.reimaginebanking.com';
  try {
    const accountsResp = await fetch(`${baseUrl}/customers/${customerId}/accounts?key=${apiKey}`);
    const accounts = await accountsResp.json();
    if (!Array.isArray(accounts)) {
      return res.status(500).json({ error: 'Unexpected accounts response from Nessie' });
    }
    let initialBalance = 0;
    let totalSavings = 0;
    let totalDebt = 0;
    let investmentBalance = 0;
    let monthlyEarnings = 0;
    let monthlySpending = 0;
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Helper to parse a date string.  If parsing fails it returns epoch 0 so
    // comparisons will likely exclude the transaction.
    const toDate = (s) => {
      try { return new Date(s); } catch { return new Date(0); }
    };

    for (const account of accounts) {
      const accBalance = Number(account.balance) || 0;
      initialBalance += accBalance;
      const type = String(account.type || '').toLowerCase();
      if (type.includes('savings')) totalSavings += accBalance;
      if (type.includes('credit')) totalDebt += Math.abs(accBalance);
      if (type.includes('investment')) investmentBalance += accBalance;
      const accId = account._id || account.id || account.account_id;
      if (!accId) continue;
      // deposits (income)
      try {
        const depResp = await fetch(`${baseUrl}/accounts/${accId}/deposits?key=${apiKey}`);
        const deposits = await depResp.json();
        if (Array.isArray(deposits)) {
          for (const d of deposits) {
            const dt = toDate(d.transaction_date);
            if (dt >= thirtyDaysAgo) monthlyEarnings += Number(d.amount) || 0;
          }
        }
      } catch (err) {
        console.error('Error fetching deposits for', accId, err);
      }
      // purchases (spending)
      try {
        const purResp = await fetch(`${baseUrl}/accounts/${accId}/purchases?key=${apiKey}`);
        const purchases = await purResp.json();
        if (Array.isArray(purchases)) {
          for (const p of purchases) {
            const dt = toDate(p.purchase_date || p.transaction_date);
            if (dt >= thirtyDaysAgo) monthlySpending += Number(p.amount) || 0;
          }
        }
      } catch (err) {
        console.error('Error fetching purchases for', accId, err);
      }
      // withdrawals (spending)
      try {
        const wResp = await fetch(`${baseUrl}/accounts/${accId}/withdrawals?key=${apiKey}`);
        const withdrawals = await wResp.json();
        if (Array.isArray(withdrawals)) {
          for (const w of withdrawals) {
            const dt = toDate(w.transaction_date);
            if (dt >= thirtyDaysAgo) monthlySpending += Number(w.amount) || 0;
          }
        }
      } catch (err) {
        console.error('Error fetching withdrawals for', accId, err);
      }
    }
    return res.json({
      initialBalance,
      monthlyEarnings,
      monthlySpending,
      totalSavings,
      totalDebt,
      monthlyInvestments: 0,
      investmentBalance
    });
  } catch (err) {
    console.error('Nessie error', err);
    res.status(500).json({ error: 'Failed to retrieve Nessie data', details: err && err.message });
  }
});

/* -------------------------- Local advice fallback --------------------------- */

function buildLocalAdvice(m, state) {
  const headline =
    state === 'FANTASTIC' ? 'Fantastic status — systems humming. 🚀' :
    state === 'THRIVING'  ? 'Strong trajectory — keep compounding. 📈' :
    state === 'HEALTHY'   ? 'On plan — maintain discipline. ✅' :
    state === 'SURVIVING' ? 'Stable, but tighten a few screws. 🛠️' :
    state === 'STRUGGLING'? 'Pressure building — quick wins needed. ⚠️' :
    state === 'CRITICAL'  ? 'Critical — address cash risk now. 🆘' :
                            'Atrocious — emergency mode. 💀';

  const pct = x => isFinite(x) ? `${Math.round(x*100)}%` : '∞';
  const one = (m.budget_ratio <= 0.8)
    ? `Good: Spend ratio ${pct(m.budget_ratio)} (≤80%). 👍`
    : (m.runway_months >= 3)
      ? `Good: Runway ${m.runway_months.toFixed(1)} mo (≥3). 💡`
      : (m.invest_rate >= 0.10)
        ? `Good: Investing ${pct(m.invest_rate)} (≥10%). 📈`
        : (m.dti <= 0.60)
          ? `Good: DTI ${pct(m.dti)} (≤60%). ✅`
          : `Good: Clear starting point. ⭐`;

  const two = (m.budget_ratio > 0.9)
    ? `Fix: Trim spend ~${Math.ceil((m.budget_ratio-0.9)*100)}% to reach ≤90%. ✂️`
    : (m.runway_months < 2)
      ? `Fix: Boost savings to 2 mo (now ${m.runway_months.toFixed(1)}). 🏦`
      : (m.invest_rate < 0.10)
        ? `Fix: Raise invest to 10% (now ${pct(m.invest_rate)}). 💸`
        : (m.dti > 1.2)
          ? `Fix: Pay down debt; DTI ${pct(m.dti)} > 120%. 📉`
          : `Fix: Pick one category to cut. 📝`;

  const weekly = Math.max(1, Math.ceil(((m.inc||0)*0.10)/4));
  const three = (m.invest_rate < 0.10)
    ? `Goal (next week): auto-move ${weekly}/wk to investing. 🗓️`
    : (m.runway_months < 3)
      ? `Goal (next week): save ${Math.ceil((m.sp||0)*0.1)} to build runway. ⛳`
      : `Goal (next week): track spend daily; keep ≤80%. 🧭`;

  return { headline, advice: [one, two, three] };
}

/* --------------------------------- Boot ------------------------------------ */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Penny server at http://localhost:${PORT}`);
  console.log('Open http://localhost:3000 (do NOT use file://)');
});