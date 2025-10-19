
// Deterministic metrics/state/health on server; Gemini only supplies headline + advice.
// Returns: { state, health, message, headline, advice }

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
const LOG = process.env.LOG_ANALYZE === '1';

app.get('/favicon.ico', (req, res) => res.status(204).end());

/* ------------------------------ Deterministic ------------------------------ */

const ALLOWED_STATES = [
  'ATROCIOUS','CRITICAL','STRUGGLING','SURVIVING','HEALTHY','THRIVING','FANTASTIC'
];

const toAllowedState = s =>
  (ALLOWED_STATES.includes(String(s).toUpperCase()) ? String(s).toUpperCase() : 'SURVIVING');

const clamp0to100 = x => Number.isFinite(+x) ? Math.max(0, Math.min(100, Math.round(+x))) : 50;

function computeMetrics(inputs) {
  const inc  = +inputs.monthly_income      || 0;
  const sp   = +inputs.monthly_spending    || 0;
  const sav  = +inputs.total_savings       || 0;
  const debt = +inputs.total_debt          || 0;
  const invM = +inputs.monthly_investments || 0; // kept for continuity, not used in advice

  // exact math
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
  if ((m.budget_ratio > 0.80 && m.budget_ratio <= 0.90) || (m.runway_months >= 2.0 && m.runway_months < 3.0)) return 'SURVIVING';
  if (m.budget_ratio <= 0.80 && (m.runway_months >= 3.0 && m.runway_months <= 6.0) && m.dti <= 0.60) return 'HEALTHY';
  if (m.budget_ratio <= 0.70 && (m.runway_months > 6.0 && m.runway_months <= 12.0) && m.dti <= 0.40) return 'THRIVING';
  if (m.budget_ratio <= 0.60 && m.runway_months > 12.0 && m.dti <= 0.20) return 'FANTASTIC';
  return 'SURVIVING';
}

function computeHealth(m) {
  let h = 50;

  // budget
  if (m.budget_ratio <= 0.80) h += 15;
  else if (m.budget_ratio <= 0.90) h += 5;
  else if (m.budget_ratio <= 1.10) h -= 10;
  else h -= 25;
  if (m.budget_ratio >= 1.50) h -= 15;

  // runway
  if (m.runway_months >= 6) h += 20;
  else if (m.runway_months >= 3) h += 10;
  else if (m.runway_months >= 2) h += 5;
  else if (m.runway_months >= 1) h -= 10;
  else { h -= 25; if (m.runway_months < 0.5) h -= 10; }

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

/* ------------------------------ Helpers (LLM) ------------------------------ */

function parseLLMJson(text) {
  if (!text) return null;
  try { return JSON.parse(text.trim()); } catch {}
  const s = String(text);
  let start = s.indexOf('{');
  while (start !== -1) {
    let depth = 0;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const maybe = s.slice(start, i + 1);
          try { return JSON.parse(maybe); } catch { break; }
        }
      }
    }
    start = s.indexOf('{', start + 1);
  }
  return null;
}

// NEW: robust extractor that also reads inlineData (base64 JSON) and functionCall.args
function extractLLMObjectFromResponse(data) {
  const cand = data?.candidates?.[0];
  if (!cand) return null;

  const parts = Array.isArray(cand?.content?.parts) ? cand.content.parts : [];
  if (LOG) {
    const kinds = parts.map(p => (p?.text ? 'text' :
                   p?.inlineData ? `inline(${p.inlineData?.mimeType||'?'})` :
                   p?.functionCall ? 'functionCall' : 'other'));
    console.log('[analyze] parts:', kinds.join(', '), 'finishReason:', cand?.finishReason || 'n/a');
  }

  // 1) Try concatenated text parts
  let combinedText = parts.map(p => (typeof p?.text === 'string' ? p.text : ''))
                          .filter(Boolean).join('');
  let obj = parseLLMJson(combinedText);
  if (obj) return obj;

  // 2) Try inlineData JSON (base64)
  for (const p of parts) {
    const mime = p?.inlineData?.mimeType || '';
    const b64  = p?.inlineData?.data || '';
    if (mime.includes('json') && b64) {
      try {
        const raw = Buffer.from(b64, 'base64').toString('utf8');
        const maybe = parseLLMJson(raw) || JSON.parse(raw);
        if (maybe) return maybe;
      } catch {}
    }
  }

  // 3) Try functionCall args (some transports place JSON there)
  for (const p of parts) {
    const args = p?.functionCall?.args;
    if (args) {
      try {
        // args might already be an object; if string, parse it
        const raw = typeof args === 'string' ? args : JSON.stringify(args);
        const maybe = parseLLMJson(raw) || JSON.parse(raw);
        if (maybe) return maybe;
      } catch {}
    }
  }

  // 4) As a last resort, try top-level text if present
  if (typeof cand?.text === 'string') {
    const maybe = parseLLMJson(cand.text) || null;
    if (maybe) return maybe;
  }

  return null;
}

function filterInvestingAdvice(advice) {
  const banned = /\b(invest|investment|stocks?|auto[-\s]?move|401k|ira)\b/i;
  const out = [];
  for (const line of (advice || [])) {
    if (!banned.test(line)) out.push(line);
  }
  while (out.length < 3) out.push('');
  return out.slice(0,3);
}

// Tail must include at least one digit and avoid generic phrases
function tailMeetsQuality(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim().toLowerCase();
  if (!t) return false;
  const hasDigit = /\d/.test(t);
  const banned = /(stay on plan|nice|good job|keep it up)/i;
  return hasDigit && !banned.test(t);
}

// Second Gemini pass to repair a weak/missing tail (still model-written)
async function repairTail(ctx, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const repairSchema = {
    type: 'OBJECT',
    properties: { tail: { type: 'STRING' } },
    required: ['tail'],
    propertyOrdering: ['tail']
  };

  const repairPrompt =
    `Rewrite ONE short sentence as the final advice.\n` +
    `Use the numbers in this JSON:\n` + JSON.stringify(ctx) + `\n\n` +
    `Rules:\n` +
    `- Exactly one explicit number (dollars or percent)\n` +
    `- No generic phrases like "stay on plan", "nice", "good job"\n` +
    `- Do NOT repeat the transaction amount or budget percent\n` +
    `- No investing words\n` +
    `Return JSON ONLY: {"tail":"..."}\n`;

  const body = {
    contents: [{ parts: [{ text: repairPrompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: repairSchema,
      temperature: 0.4,
      maxOutputTokens: 10000
    }
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await r.json().catch(() => ({}));
  const cand = data?.candidates?.[0];
  let raw = '';
  if (Array.isArray(cand?.content?.parts)) {
    // support inlineData in repair too
    for (const p of cand.content.parts) {
      if (typeof p?.text === 'string') raw += p.text;
      if (p?.inlineData?.mimeType?.includes('json') && p?.inlineData?.data) {
        try { raw += Buffer.from(p.inlineData.data, 'base64').toString('utf8'); } catch {}
      }
    }
  } else if (typeof cand?.text === 'string') {
    raw = cand.text;
  }

  try {
    const obj = JSON.parse((raw || '').trim());
    if (tailMeetsQuality(obj?.tail)) return obj.tail.trim();
  } catch {}
  return '';
}

/* ---------------------------------- Route ---------------------------------- */

app.post('/analyze', async (req, res) => {
  try {
    const inputs = req.body.inputs || {};
    const m = computeMetrics(inputs);
    const state = pickState(m);
    const health = computeHealth(m);

    const ctx = {
      budget_ratio_pct: Number.isFinite(m.budget_ratio) ? Math.round(m.budget_ratio*100) : '∞',
      runway_months_1d: +m.runway_months.toFixed(1),
      dti_pct:          Number.isFinite(m.dti) ? Math.round(m.dti*100) : '∞',
      state,
      health,
      current_balance: Number(inputs.current_balance || 0),
      transaction_amount: Number(inputs.transaction_amount || 0),
      monthly_income: m.inc,
      monthly_spending: m.sp,
      total_savings: m.sav,
      total_debt: m.debt
    };

    if (LOG) console.log('[analyze] ctx=', ctx);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing GEMINI_API_KEY in .env' });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const responseSchema = {
      type: 'OBJECT',
      properties: {
        headline: { type: 'STRING' },
        advice:   { type: 'ARRAY', items: { type: 'STRING' }, minItems: 3, maxItems: 3 }
      },
      required: ['headline','advice'],
      propertyOrdering: ['headline','advice']
    };

    const coachPrompt =
      `You are a concise, friendly money coach. Keep it simple and cute.\n` +
      `Use 1 emoji per line. Max ~60 chars per bullet. No hashtags.\n` +
      `Use the numbers in the JSON object below.\n` +
      `Do NOT mention investing, investments, stocks, auto-moves, or investing accounts.\n\n` +
      `Numbers:\n` + JSON.stringify(ctx) + `\n\n` +
      `Return JSON ONLY (no code fences):\n` +
      `{\n  "headline": "<<=80 chars, can include 1 emoji>",\n` +
      `  "advice": [\n` +
      `    "Good: <strength tied to a number>",\n` +
      `    "Fix: <highest-impact fix tied to a number>",\n` +
      `    "Goal (next week): <one tiny step with a number>"\n` +
      `  ]\n}\n` +
      `For advice[2], write ONE short sentence that summarizes bank health and gives one concrete action using the numbers above.\n` +
      `It must include exactly one explicit number (dollars or percent). Do not reuse stock phrases. Do NOT repeat the transaction amount or budget percent. Do NOT mention investing.\n`;

    const body = {
      contents: [{ parts: [{ text: coachPrompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0.2,
        maxOutputTokens: 10000
      }
    };

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await r.json().catch(() => ({}));

    const cand   = data?.candidates?.[0];
    const finish = cand?.finishReason;
    if (LOG) console.log('[analyze] finishReason=', finish || 'n/a');

    // Robust extraction (text, inlineData, functionCall.args)
    let llmObj = extractLLMObjectFromResponse(data);

    // If unusable, return blanks (client shows only the base sentence)
    if (!llmObj || !Array.isArray(llmObj.advice) || typeof llmObj.headline !== 'string') {
      if (LOG) console.log('[analyze] MODE=BLANK', { state, health });
      return res.status(200).json({ state, health, message: '', headline: '', advice: ['', '', ''] });
    }

    // Normalize + filter + quality gate / repair
    const headline = String(llmObj.headline || '').trim();
    let advice = normalizeAdvice(llmObj.advice);
    advice = filterInvestingAdvice(advice);

    if (!tailMeetsQuality(advice[2])) {
      const repaired = await repairTail(ctx, apiKey);
      if (repaired) advice[2] = repaired;
    }
    if (!tailMeetsQuality(advice[2])) advice[2] = '';

    const message  = makeSpeechMessage(headline, advice);
    if (LOG) console.log('[analyze] MODE=LLM', { headline, tail: advice?.[2] });

    return res.json({ state, health, message, headline, advice });

  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

/* -------------------------- Local advice fallback --------------------------- */
// (Kept intact; not used when returning blanks above, but left here per request)
function buildLocalAdvice(m, state, ctx) {
  const headline =
    state === 'FANTASTIC' ? 'Fantastic status — systems humming. 🚀' :
    state === 'THRIVING'  ? 'Strong trajectory — keep compounding. 📈' :
    state === 'HEALTHY'   ? 'On plan — maintain discipline. ✅' :
    state === 'SURVIVING' ? 'Stable, but tighten a few screws. 🛠️' :
    state === 'STRUGGLING'? 'Pressure building — quick wins needed. ⚠️' :
    state === 'CRITICAL'  ? 'Critical — address cash risk now. 🆘' :
                            'Atrocious — emergency mode. 💀';

  const pct = x => (isFinite(x) ? `${Math.round(x*100)}%` : '∞');

  const one =
    (m.budget_ratio <= 0.80) ? `Good: Spend ratio ${pct(m.budget_ratio)} (≤80%). 👍` :
    (m.runway_months >= 3)   ? `Good: Runway ${m.runway_months.toFixed(1)} mo (≥3). 💡` :
    (m.dti <= 0.60)          ? `Good: DTI ${pct(m.dti)} (≤60%). ✅` :
                               `Good: Clear starting point. ⭐`;

  const two =
    (m.budget_ratio > 0.90) ? `Fix: Trim spend ~${Math.ceil((m.budget_ratio-0.9)*100)}% to reach ≤90%. ✂️` :
    (m.runway_months < 2)   ? `Fix: Boost savings to 2 mo (now ${m.runway_months.toFixed(1)}). 🏦` :
    (m.dti > 1.2)           ? `Fix: Pay down debt; DTI ${pct(m.dti)} > 120%. 📉` :
                               `Fix: Pick one category to cut. 📝`;

  const three = `Goal (next week): keep daily spending at or below ${Math.max(1, Math.ceil((m.inc*0.80 - m.sp)))} dollars.`;

  return { headline, advice: [one, two, three] };
}

/* --------------------------------- Boot ------------------------------------ */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Penny server at http://localhost:${PORT}`);
  console.log('Open http://localhost:3000 (do NOT use file://)');
}); 