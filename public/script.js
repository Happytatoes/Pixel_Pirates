// script.js
import { analyzeFinancialData } from './gemini-service.js';

/* ------------------------------- Debug helper ------------------------------- */
// Simple local test that uses the *exported* analyzeFinancialData and logs the result.
window.debugGemini = async function () {
  const testData = {
    income: '5000',
    spending: '3000',
    savings: '10000',
    debt: '2000',
    monthlyInvestments: '500',
    investmentBalance: '15000'
  };
  try {
    console.log('=== analyzeFinancialData(test) ===');
    const out = await analyzeFinancialData(testData);
    console.log(out);
  } catch (err) {
    console.error('Debug failed:', err);
  }
};

window.switchPage = function(pageId) {
  const pages = document.querySelectorAll('.page');
  pages.forEach(page => page.classList.remove('active'));

  const targetPage = document.getElementById(pageId);
  if (targetPage) targetPage.classList.add('active');

  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('onclick').includes(pageId)) {
      btn.classList.add('active');
    }
  });
};

// Load state on page load
function loadPetState() {
  const saved = localStorage.getItem('pennyState');
  if (saved) {
    const state = JSON.parse(saved);
    updatePetDisplay(state);
  }
}

// Temporary debug function - add at the top of script.js
window.debugGemini = async function() {
  const testData = {
    income: '5000',
    spending: '3000',
    savings: '10000',
    debt: '2000',
    monthlyInvestments: '500',
    investmentBalance: '15000'
  };

  try {
    // NOTE: buildFinancialPrompt/callGeminiAPI were part of older flows.
    // Keeping this block for your own debugging if those functions exist globally.
    if (typeof buildFinancialPrompt === 'function' && typeof callGeminiAPI === 'function') {
      const prompt = buildFinancialPrompt(testData);
      console.log('=== PROMPT ===');
      console.log(prompt);

      const response = await callGeminiAPI(prompt);
      console.log('=== RAW RESPONSE ===');
      console.log(JSON.stringify(response, null, 2));

      if (response.candidates && response.candidates[0]) {
        console.log('=== CANDIDATE STRUCTURE ===');
        console.log(response.candidates[0]);

        if (response.candidates[0].content) {
          console.log('=== CONTENT ===');
          console.log(response.candidates[0].content);

          if (response.candidates[0].content.parts) {
            console.log('=== TEXT ===');
            console.log(response.candidates[0].content.parts[0].text);
          }
        }
      }
    }
  } catch (error) {
    console.error('Debug failed:', error);
  }
};

/* ---------------------------- Pet state/visuals ---------------------------- */
/*
   Swap emojis for images in /public/images:
   - egg.webp
   - critical.webp
   - struggling.webp
   - happy.webp
   - thriving.webp

   We reuse the closest image for states without a dedicated asset (SURVIVING → happy.webp,
   LEGENDARY → thriving.webp, FLATLINED → critical.webp). Add more .webp files later and
   just update the map below.
*/
const PET_IMAGE_BASE = '/images';
const PET_STATES = {
  FLATLINED: { img: 'critical.webp',  className: 'flatlined',  name: 'FLATLINED',  animation: 'pulse'  },
  CRITICAL:  { img: 'critical.webp',  className: 'critical',    name: 'CRITICAL',   animation: 'bounce' },
  STRUGGLING:{ img: 'struggling.webp',className: 'struggling',  name: 'STRUGGLING', animation: 'pulse'  },
  SURVIVING: { img: 'happy.webp',     className: 'surviving',   name: 'SURVIVING',  animation: ''       },
  HEALTHY:   { img: 'happy.webp',     className: 'healthy',     name: 'HEALTHY',    animation: ''       },
  THRIVING:  { img: 'thriving.webp',  className: 'thriving',    name: 'THRIVING',   animation: 'bounce' },
  LEGENDARY: { img: 'thriving.webp',  className: 'legendary',   name: 'LEGENDARY',  animation: 'pulse'  },
  EGG:       { img: 'egg.webp',       className: 'egg',         name: 'EGG',        animation: 'bounce' }
};

// (Optional) Preload images to avoid flicker
(function preloadPetImages() {
  try {
    const unique = new Set(Object.values(PET_STATES).map(s => s.img));
    unique.forEach(name => {
      const img = new Image();
      img.src = `${PET_IMAGE_BASE}/${name}`;
    });
  } catch {}
})();

function toAllowedState(s) {
  const up = String(s || '').toUpperCase();
  return PET_STATES[up] ? up : 'SURVIVING';
}

function clamp0to100(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/* ------------------------------ UI composition ----------------------------- */
// Always safe-update the UI (even if fields are missing).
function updatePetDisplay(analysis) {
  const petArea     = document.getElementById('petArea');
  const pet         = document.getElementById('pet');
  const stateName   = document.getElementById('stateName');
  const petMessage  = document.getElementById('petMessage');
  const stats       = document.getElementById('stats');
  const healthBar   = document.getElementById('healthBar');
  const healthValue = document.getElementById('healthValue');

  const stateKey = toAllowedState(analysis?.state);
  const current  = PET_STATES[stateKey];

  // Background / animation
  if (petArea) petArea.className = 'pet-area ' + current.className;

  // === NEW: render .webp image instead of an emoji ===
  if (pet) {
    const imgName = current.img || 'happy.webp';
    const src = `${PET_IMAGE_BASE}/${imgName}`;
    pet.className = 'pet ' + current.animation;

    // If there's already an <img>, update its src; otherwise inject one.
    let img = pet.querySelector('img.pet-img');
    if (!img) {
      pet.innerHTML = ''; // clear any emoji text
      img = document.createElement('img');
      img.className = 'pet-img';
      img.width = 96;      // match your previous emoji visual size
      img.height = 96;
      img.decoding = 'async';
      img.alt = current.name;
      pet.appendChild(img);
    }
    img.src = src;
    img.alt = current.name;
  }

  if (stateName) stateName.textContent = current.name;

  // Health bar (show when health is a number)
  const health = clamp0to100(analysis?.health);
  if (typeof analysis?.health === 'number') {
    if (stats) stats.style.display = 'flex';
    if (healthBar) {
      healthBar.style.width = health + '%';
      if (health <= 20)      healthBar.setAttribute('data-health', 'critical');
      else if (health <= 40) healthBar.setAttribute('data-health', 'low');
      else if (health <= 60) healthBar.setAttribute('data-health', 'medium');
      else if (health <= 80) healthBar.setAttribute('data-health', 'good');
      else                   healthBar.setAttribute('data-health', 'excellent');
    }
    if (healthValue) healthValue.textContent = health + '%';
  } else {
    if (stats) stats.style.display = 'none';
  }

  // Message (headline+bullets already composed by gemini-service finalizeForUI)
  const safeMsg = String(analysis?.message || '').trim();
  if (safeMsg && petMessage) petMessage.textContent = safeMsg;
}

/* --------------------------- Submit handler (NEW) --------------------------- */
async function handleSubmit() {
  const income             = document.getElementById('income').value;
  const spending           = document.getElementById('spending').value;
  const savings            = document.getElementById('savings').value;
  const debt               = document.getElementById('debt').value;
  const monthlyInvestments = document.getElementById('monthlyInvestments').value;
  const investmentBalance  = document.getElementById('investmentBalance').value;

  if (!income || !spending || !savings || !debt || !monthlyInvestments || !investmentBalance) {
    alert('Please fill in all fields!');
    return;
  }

  const formData = { income, spending, savings, debt, monthlyInvestments, investmentBalance };

  const submitBtn = document.getElementById('submitBtn');
  const petMsgEl  = document.getElementById('petMessage');

  // 1) set analyzing
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Analyzing with AI...';
  }
  if (petMsgEl) petMsgEl.textContent = 'Gemini is analyzing your finances... This might take a moment!';

  try {
    // 2) call analyzer
    const analysis = await analyzeFinancialData(formData);

    // 3) update visuals (guard exceptions)
    try { updatePetDisplay(analysis); } catch (e) { console.warn('updatePetDisplay error:', e); }
    window.switchPage('petView');

    // 4) force-overwrite the bubble text in the on-card speech area
    const nextMsg =
      (analysis && typeof analysis.message === 'string' && analysis.message.trim()) ||
      (analysis && typeof analysis.headline === 'string' && analysis.headline.trim()) ||
      'Analysis complete.';
    if (petMsgEl) petMsgEl.textContent = nextMsg;

  } catch (error) {
    console.error('Analysis failed:', error);
    if (petMsgEl) petMsgEl.textContent = `${error?.message || 'Something went wrong.'}`;
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Feed Penny';
    }
  }
}

// Event Listeners
document.getElementById('submitBtn').addEventListener('click', handleSubmit);
document.addEventListener('DOMContentLoaded', () => { loadPetState(); });

// Enter to submit
document.querySelectorAll('input').forEach(input => {
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSubmit();
  });
});
