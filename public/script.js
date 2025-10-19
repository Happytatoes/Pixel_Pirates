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
    //console.log('Switching to:', pageId); // Debug
    
    // Hide all pages
    const pages = document.querySelectorAll('.page');
    pages.forEach(page => page.classList.remove('active'));
    
    // Show target page
    const targetPage = document.getElementById(pageId);
    if (targetPage) {
        targetPage.classList.add('active');
    }
    
    // Update nav buttons
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
    } catch (error) {
        console.error('Debug failed:', error);
    }
};

/* ---------------------------- Pet state/visuals ---------------------------- */
const PET_STATES = {
  FLATLINED: { emoji: '💀', className: 'flatlined', name: 'FLATLINED', animation: 'pulse' },
  CRITICAL:  { emoji: '🤢', className: 'critical',  name: 'CRITICAL',  animation: 'bounce' },
  STRUGGLING:{ emoji: '😰', className: 'struggling',name: 'STRUGGLING',animation: 'pulse' },
  SURVIVING: { emoji: '😐', className: 'surviving', name: 'SURVIVING', animation: '' },
  HEALTHY:   { emoji: '😊', className: 'healthy',   name: 'HEALTHY',   animation: '' },
  THRIVING:  { emoji: '✨', className: 'thriving',  name: 'THRIVING',  animation: 'bounce' },
  LEGENDARY: { emoji: '🔥', className: 'legendary', name: 'LEGENDARY', animation: 'pulse' },
  EGG:       { emoji: '🥚', className: 'egg',       name: 'EGG',       animation: 'bounce' }
};

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

  // Background / emoji / animation
  if (petArea) petArea.className = 'pet-area ' + current.className;
  if (pet) {
    pet.textContent = current.emoji;
    pet.className = 'pet ' + current.animation;
  }
  if (stateName) stateName.textContent = current.name;

  // Health bar (show when health is a number)
  /*Changed to color-code health bar based on level*/
  const health = clamp0to100(analysis?.health);
  if (typeof analysis?.health === 'number') {
    if (stats) stats.style.display = 'flex';
    if (healthBar) {
      healthBar.style.width = health + '%';
      
      // Set color based on health level
      if (health <= 20) {
        healthBar.setAttribute('data-health', 'critical');
      } else if (health <= 40) {
        healthBar.setAttribute('data-health', 'low');
      } else if (health <= 60) {
        healthBar.setAttribute('data-health', 'medium');
      } else if (health <= 80) {
        healthBar.setAttribute('data-health', 'good');
      } else {
        healthBar.setAttribute('data-health', 'excellent');
      }
    }
    if (healthValue) healthValue.textContent = health + '%';
  } else {
    // Hide if not present
    if (stats) stats.style.display = 'none';
  }

  // Message (headline+bullets already composed by gemini-service finalizeForUI)
  const safeMsg = String(analysis?.message || '').trim();
  if (safeMsg && petMessage) petMessage.textContent = safeMsg;
}

/* --------------------------- Submit handler (NEW) --------------------------- */
// Always overwrites the “analyzing…” line — even if updatePetDisplay throws.
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
    // 4) force-overwrite the bubble
    const nextMsg =
      (analysis && typeof analysis.message === 'string' && analysis.message.trim()) ||
      (analysis && typeof analysis.headline === 'string' && analysis.headline.trim()) ||
      '✅ Analysis complete.';
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

// Event Listeners (keep these)
document.getElementById('submitBtn').addEventListener('click', handleSubmit);

document.addEventListener('DOMContentLoaded', () => {
    loadPetState();
});

document.querySelectorAll('input').forEach(input => {
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSubmit();
  });
});
