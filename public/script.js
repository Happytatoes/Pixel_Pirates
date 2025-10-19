// script.js
import { analyzeFinancialData } from './gemini-service.js';
import { fetchNessieData } from './nessie-service.js';

/*
 * Persistent progress helpers
 *
 * We track the user's daily deposit and withdrawal activity to compute both an
 * instantaneous mood change and a longer‑term monthly health score. Each day
 * in this simplified simulation consists of one deposit and one withdrawal.
 * If an action happens twice in a row (two deposits or two withdrawals) the
 * missing counterpart is treated as zero for that day. After 30 days the
 * counters reset. Progress is stored in localStorage so it survives page
 * reloads.
 */

// Holds the most recent analysis returned from the Gemini server. We update
// the health and state on this object after each day completes, but keep
// the headline and advice untouched so the pet always returns to the same
// narrative after a short reaction.
let overallAnalysis = null;
// For separating short-term reactions (temporary state) from long-term health
// we track the last non-temporary analysis here. When updatePetDisplay is
// called with isTemporary=false, we save the analysis into overallHealthState.
let revertTimeout = null;
let overallHealthState = null;

// Prefill form fields with Nessie data on page load.  This runs once when
// the DOM is ready.  If the Nessie endpoint is not configured or returns
// an error the catch block silently ignores the failure and leaves fields
// blank for manual entry.
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const data = await fetchNessieData();
    if (data && typeof data === 'object') {
      const initBalInput = document.getElementById('initialBalance');
      const earningsInput = document.getElementById('monthlyEarnings');
      const budgetInput = document.getElementById('monthlyBudget');
      if (initBalInput) initBalInput.value = data.initialBalance ?? '';
      if (earningsInput) earningsInput.value = data.monthlyEarnings ?? '';
      if (budgetInput) budgetInput.value = data.monthlySpending ?? '';
    }
  } catch (err) {
    console.warn('Nessie data unavailable:', err);
  }
});

window.__pennyTempSpeech = window.__pennyTempSpeech || '';


function getProgress() {
  return {
    dayCount: parseInt(localStorage.getItem('dayCount')) || 0,
    dailyDeposit: parseFloat(localStorage.getItem('dailyDeposit')) || 0,
    dailyWithdraw: parseFloat(localStorage.getItem('dailyWithdraw')) || 0,
    totalDeposits: parseFloat(localStorage.getItem('totalDeposits')) || 0,
    totalWithdrawals: parseFloat(localStorage.getItem('totalWithdrawals')) || 0,
    lastAction: localStorage.getItem('lastAction') || null
  };
}

function saveProgress(p) {
  localStorage.setItem('dayCount', p.dayCount);
  localStorage.setItem('dailyDeposit', p.dailyDeposit);
  localStorage.setItem('dailyWithdraw', p.dailyWithdraw);
  localStorage.setItem('totalDeposits', p.totalDeposits);
  localStorage.setItem('totalWithdrawals', p.totalWithdrawals);
  // persist lastAction as empty string when null to avoid string 'null'
  localStorage.setItem('lastAction', p.lastAction || '');
}

function resetProgress() {
  const p = {
    dayCount: 0,
    dailyDeposit: 0,
    dailyWithdraw: 0,
    totalDeposits: 0,
    totalWithdrawals: 0,
    lastAction: null
  };
  saveProgress(p);
}

// Converts a numeric health score (0–100) into a game state name. These
// thresholds mirror those used on the backend. Keep in sync with
// gemini-service.js.
function stateFromHealth(h) {
  const n = Number(h);
  if (!Number.isFinite(n)) return 'SURVIVING';
  if (n < 15) return 'ATROCIOUS';
  if (n < 30) return 'CRITICAL';
  if (n < 45) return 'STRUGGLING';
  if (n < 60) return 'SURVIVING';
  if (n < 75) return 'HEALTHY';
  if (n < 90) return 'THRIVING';
  return 'FANTASTIC';
}

// Computes a revised overall health score based on current balance, how much
// has been deposited versus withdrawn over the month so far, and how those
// numbers compare to the user's budget. The returned value is bounded
// between 0 and 100. See README for details.
function computeOverallHealth() {
  /*
   * The overall health score reflects both long‑term wealth accumulation and
   * day‑to‑day budgeting habits. We start from 50 and adjust the score
   * using several factors:
   *   1) How much your current balance has grown or shrunk compared to
   *      your initial balance. Large gains boost the score; large losses
   *      lower it. This encourages building wealth over time.
   *   2) The momentum of your deposits versus withdrawals over the entire
   *      cycle. A net surplus adds a small bonus, while a net deficit
   *      subtracts a small amount. This rewards consistent saving.
   *   3) Your average net change per day relative to your earning/spending
   *      ability. Saving more than your daily budget or earnings nudges
   *      the score up, while spending more nudges it down.
   *   4) Your projected monthly spending relative to your budget. Staying
   *      under budget adds a few points; overspending takes points away.
   */
  const { initialBalance, monthlyBudget, monthlyEarnings } = getFinancialData();
  const progress = getProgress();
  const currentBal = getCurrentBalance();

  // Use a small baseline to avoid divide‑by‑zero if initial balance is zero.
  const initBal = initialBalance || 1;

  // Begin from neutral midpoint.
  let score = 50;

  // 1) Balance change ratio: compute how much your current balance has
  //    increased or decreased relative to your starting balance. We weight
  //    this heavily because growing your nest egg is the most important
  //    indicator of long‑term financial health. A 100% gain adds 40 points;
  //    a 100% loss subtracts 40 points. Anything beyond ±100% is capped.
  const balRatio = (currentBal - initialBalance) / initBal;
  score += Math.max(-40, Math.min(40, balRatio * 50));

  // 2) Momentum of deposits vs withdrawals: look at the cumulative net
  //    deposits relative to your starting balance. This is a smaller factor
  //    because large deposits/withdrawals already show up in the balance.
  let netTotalRatio = (progress.totalDeposits - progress.totalWithdrawals) / initBal;
  netTotalRatio = Math.max(-1, Math.min(1, netTotalRatio));
  score += netTotalRatio * 10; // ±10

  // 3) Average daily net change compared to your earning/spending power.
  //    This rewards regular saving (net positive) and discourages net
  //    withdrawals. We compare the average net change to either your daily
  //    budget (if known) or your daily income. The effect is capped to
  //    ±10 points.
  const days = progress.dayCount || 1;
  const avgNet = (progress.totalDeposits - progress.totalWithdrawals) / days;
  let dailyRatio = 0;
  if (monthlyBudget > 0) {
    const dailyBudget = monthlyBudget / 30;
    dailyRatio = avgNet / dailyBudget;
  } else if (monthlyEarnings > 0) {
    const dailyEarnings = monthlyEarnings / 30;
    dailyRatio = avgNet / dailyEarnings;
  }
  // Clamp dailyRatio so extreme values don't dominate
  dailyRatio = Math.max(-1, Math.min(1, dailyRatio));
  score += dailyRatio * 10;

  // 4) Projected monthly spending relative to budget. We estimate your
  //    monthly spending based on your average daily withdrawals minus
  //    deposits. Underspending relative to budget adds up to 10 points;
  //    overspending subtracts up to 20 points. This keeps budgets in mind
  //    without overwhelming the impact of actual savings.
  if (monthlyBudget > 0) {
    const monthlyExpectedSpending = (progress.totalWithdrawals - progress.totalDeposits) / days * 30;
    const spendingRatio = monthlyExpectedSpending / monthlyBudget;
    if (spendingRatio > 1) {
      // For every 10% over budget, subtract 2 points, up to -20
      score -= Math.min(20, (spendingRatio - 1) * 20);
    } else {
      // For being under budget, add up to 10 points depending on how much is saved
      score += Math.min(10, (1 - spendingRatio) * 10);
    }
  }

  return clamp0to100(score);
}

// When a deposit is made, update the progress tracker. Depending on the
// previous action this may finalize a day (assigning missing values as 0) or
// start a new day. See README for the day definition rules.
function handleDepositProgress(amount) {
  const p = getProgress();
  if (p.lastAction === 'deposit') {
    // two deposits in a row: finalize previous day with withdraw=0
    finalizeDay(p.dailyDeposit, 0);
    // start new day with this deposit
    p.dailyDeposit = amount;
    p.dailyWithdraw = 0;
    p.lastAction = 'deposit';
  } else if (p.lastAction === 'withdraw') {
    // deposit completes a day after a withdrawal; deposit and previous withdraw
    finalizeDay(amount, p.dailyWithdraw);
    // no ongoing day
    p.dailyDeposit = 0;
    p.dailyWithdraw = 0;
    p.lastAction = null;
  } else {
    // first action of the day is a deposit
    p.dailyDeposit = amount;
    p.dailyWithdraw = 0;
    p.lastAction = 'deposit';
  }
  saveProgress(p);
}

// When a withdrawal is made, update the progress tracker. Depending on the
// previous action this may finalize a day or start a new day. See README.
function handleWithdrawProgress(amount) {
  const p = getProgress();
  if (p.lastAction === 'withdraw') {
    // two withdrawals in a row: finalize previous day with deposit=0
    finalizeDay(0, p.dailyWithdraw);
    // start new day with this withdrawal
    p.dailyDeposit = 0;
    p.dailyWithdraw = amount;
    p.lastAction = 'withdraw';
  } else if (p.lastAction === 'deposit') {
    // withdrawal completes a day after a deposit; deposit and this withdrawal
    finalizeDay(p.dailyDeposit, amount);
    p.dailyDeposit = 0;
    p.dailyWithdraw = 0;
    p.lastAction = null;
  } else {
    // first action of the day is a withdrawal
    p.dailyDeposit = 0;
    p.dailyWithdraw = amount;
    p.lastAction = 'withdraw';
  }
  saveProgress(p);
}

// Finalize a day by adding the deposit and withdrawal amounts to the monthly
// totals and incrementing the day counter. If 30 days have passed, reset
// the totals for a fresh monthly cycle. This does not persist the daily
// deposit/withdraw—those should be cleared by the caller.
function finalizeDay(depositAmt, withdrawAmt) {
  const p = getProgress();
  p.totalDeposits += depositAmt;
  p.totalWithdrawals += withdrawAmt;
  p.dayCount += 1;
  if (p.dayCount >= 30) {
    p.dayCount = 0;
    p.totalDeposits = 0;
    p.totalWithdrawals = 0;
  }
  // after finalizing a day, recompute overall health and update
  if (overallAnalysis) {
    const newHealth = computeOverallHealth();
    overallAnalysis.health = newHealth;
    overallAnalysis.state = stateFromHealth(newHealth);
  }
  saveProgress(p);
}


/* ----------------------------- Navigation ----------------------------- */
window.switchPage = function(pageId) {
   const pages = document.querySelectorAll('.page');
   pages.forEach(page => page.classList.remove('active'));
  
   const targetPage = document.getElementById(pageId);
   if (targetPage) {
       targetPage.classList.add('active');
   }
  
   const navBtns = document.querySelectorAll('.nav-btn');
   navBtns.forEach(btn => {
       btn.classList.remove('active');
       if (btn.getAttribute('onclick').includes(pageId)) {
           btn.classList.add('active');
       }
   });


   // Update balance display when switching to finance view
   if (pageId === 'financeView') {
       updateBalanceDisplay();
   }
};


function handleReset() {
    // Confirm with user
    window.__pennyTempSpeech = '';
    console.log("RESET CLICKED");

    // Clear all localStorage
    localStorage.removeItem('currentBalance');
    localStorage.removeItem('initialBalance');
    localStorage.removeItem('monthlyEarnings');
    localStorage.removeItem('monthlyBudget');
    localStorage.removeItem('pennyState');

    // Reset to egg state
    const eggState = {
        state: 'EGG',
        health: 0,
        message: "Feed me your financial data! I'm ready to hatch!"
    };

    updatePetDisplay(eggState);
    updateBalanceDisplay();

    // Clear all input fields
    document.getElementById('initialBalance').value = '';
    document.getElementById('monthlyEarnings').value = '';
    document.getElementById('monthlyBudget').value = '';
    document.getElementById('depositAmount').value = '';
    document.getElementById('withdrawAmount').value = '';

    // Hide speech bubble
    if (window.pennyHideMessage) {
        window.pennyHideMessage();
    }

    // Show success message
    //alert('✅ Reset complete! Penny is back to an egg.');
    
    // Switch to pet view
    window.switchPage('petView');
}

/* ------------------------- localStorage Helpers ------------------------- */
function getCurrentBalance() {
   return parseFloat(localStorage.getItem('currentBalance')) || 0;
}


function setCurrentBalance(amount) {
   localStorage.setItem('currentBalance', amount);
   updateBalanceDisplay();
}


function getFinancialData() {
   return {
       initialBalance: parseFloat(localStorage.getItem('initialBalance')) || 0,
       monthlyEarnings: parseFloat(localStorage.getItem('monthlyEarnings')) || 0,
       monthlyBudget: parseFloat(localStorage.getItem('monthlyBudget')) || 0
   };
}


function saveFinancialData(data) {
   localStorage.setItem('initialBalance', data.initialBalance);
   localStorage.setItem('monthlyEarnings', data.monthlyEarnings);
   localStorage.setItem('monthlyBudget', data.monthlyBudget);
}


function updateBalanceDisplay() {
   const balance = getCurrentBalance();
   const displayEl = document.getElementById('currentBalanceDisplay');
   if (displayEl) {
       displayEl.textContent = `$${balance.toFixed(2)}`;
   }
}


function savePetState(state) {
   localStorage.setItem('pennyState', JSON.stringify(state));
}


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
  ATROCIOUS: { img: 'critical.webp',  className: 'atrocious',  name: 'ATROCIOUS',  animation: 'pulse'  },
  CRITICAL:  { img: 'critical.webp',  className: 'critical',    name: 'CRITICAL',   animation: 'pulse' },
  STRUGGLING:{ img: 'struggling.webp',className: 'struggling',  name: 'STRUGGLING', animation: 'pulse'  },
  SURVIVING: { img: 'happy.webp',     className: 'surviving',   name: 'SURVIVING',  animation: ''       },
  HEALTHY:   { img: 'happy.webp',     className: 'healthy',     name: 'HEALTHY',    animation: ''       },
  THRIVING:  { img: 'thriving.webp',  className: 'thriving',    name: 'THRIVING',   animation: 'bounce' },
  FANTASTIC: { img: 'thriving.webp',  className: 'fantastic',   name: 'FANTASTIC',  animation: 'bounce'  },
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


/* -------------------------- Update Pet Display -------------------------- */
function updatePetDisplay(analysis, isTemporary = false, updateBarWhenTemporary = false) {
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
    pet.className = 'pet';   // animations are driven only by the temp reaction code

    // If there's already an <img>, update its src; otherwise inject one.
    let img = pet.querySelector('img.pet-img');
    if (!img) {
      pet.innerHTML = ''; // clear any emoji text
      img = document.createElement('img');
      img.className = 'pet-img';
      img.width = 180;      // match your previous emoji visual size
      img.height = 180;
      img.decoding = 'async';
      img.alt = current.name;
      pet.appendChild(img);
    }
    img.src = src;
    img.alt = current.name;
  }

  const prevState = pet.dataset.state || '';
  pet.dataset.state = current.name;

  // Clean any prior temp class
  pet.classList.remove('bounce', 'pulse');

  // Apply only for temporary render AND only if the state actually changed
  if (isTemporary) {
    // Choose the animation by direction: up = good (bounce), down = negative (pulse)
    const animClass = (analysis && analysis.direction === 'down') ? 'pulse' : 'bounce';


    // Retrigger by toggling (ensure animation restarts)
    void pet.offsetWidth;
    pet.classList.add(animClass);

    // Remove the temp class when the CSS animation ends so the pet is still on revert
    if (!pet._tempAnimBound) {
      pet.addEventListener('animationend', () => {
        pet.classList.remove('bounce', 'pulse');
      });
      pet._tempAnimBound = true;
    }
  }

  if (stateName) {
      // show the reaction word during temp reactions; otherwise show long-term state name
      stateName.textContent = (isTemporary && analysis?.state) ? analysis.state : current.name;
    }
  // When updating the pet, decide whether to change the health bar.
  // For temporary reactions (isTemporary=true), we do not update the health bar.
  const health = clamp0to100(analysis?.health);
  // Update the health bar when either this is a permanent update (isTemporary is false)
  // or when explicitly requested for a temporary reaction via updateBarWhenTemporary.
  if ((updateBarWhenTemporary || !isTemporary) && typeof analysis?.health === 'number') {
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
  }
  // When temporary and not updating the bar, keep the existing health bar state; no need to hide stats or update

  // Message (headline+bullets already composed by gemini-service finalizeForUI)

  const safeMsg = String(analysis?.message || '').trim();

  if (isTemporary) {
      if (safeMsg && petMessage) {
          petMessage.textContent = safeMsg;
          // Remember this temporary message so it persists on revert
          window.__pennyTempSpeech = safeMsg;
      }
  } else {
      if (window.__pennyTempSpeech && petMessage) {
          // A temporary message is active; keep showing it
          petMessage.textContent = window.__pennyTempSpeech;
      } else if (safeMsg && petMessage) {
          // No active temporary message; show the long-term message
          petMessage.textContent = safeMsg;
      }
  }

  if (isTemporary && analysis && analysis.direction) {
    showArrows(analysis.direction);   // 'up' or 'down'
  }

  // For permanent updates, remember this state so we can revert to it later.
  if (!isTemporary) {
    overallHealthState = analysis;
    overallAnalysis = analysis;
  }

  // If this is a temporary reaction, schedule a revert back to the long‑term state
  // after a short delay. This preserves the long-term health bar while showing
  // an immediate state change. The revert uses the stored overallHealthState and
  // does not modify the health bar unless the revert call requests it.
  if (isTemporary && overallHealthState) {
      clearTimeout(revertTimeout);
      revertTimeout = setTimeout(() => {
          if (overallHealthState) {
              updatePetDisplay(overallHealthState, false);
              // Persist the overall state
              try {
                  savePetState(overallHealthState);
              } catch {}
              // Do not update the speech bubble here; the temporary message should persist.
          }
      }, 3000);
  }

}

function showArrows(direction) {
  const petEl = document.getElementById('pet');
  if (!petEl) return;

  petEl.querySelectorAll('.arrow-container').forEach(el => el.remove());

  if (getComputedStyle(petEl).position === 'static') petEl.style.position = 'relative';
  const container = document.createElement('div');
  container.className = 'arrow-container';

  for (let i = 0; i < 3; i++) {
    const arrow = document.createElement('div');
    arrow.className = (direction === 'down') ? 'arrow-down' : 'arrow-up';
    container.appendChild(arrow);
  }

  petEl.appendChild(container);
  setTimeout(() => { try { container.remove(); } catch {} }, 1200);
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





/* ----------------------- Feed Penny (Gemini Analysis) ----------------------- */
async function handleFeedPenny() {
   window.__pennyTempSpeech = '';
   const initialBalance = document.getElementById('initialBalance').value;
   const monthlyEarnings = document.getElementById('monthlyEarnings').value;
   const monthlyBudget = document.getElementById('monthlyBudget').value;


   if (!initialBalance || !monthlyEarnings || !monthlyBudget) {
       alert('Please fill in all financial info fields!');
       return;
   }


   // Save to localStorage
   saveFinancialData({
       initialBalance: parseFloat(initialBalance),
       monthlyEarnings: parseFloat(monthlyEarnings),
       monthlyBudget: parseFloat(monthlyBudget)
   });


   // Set current balance to initial balance if not set
   if (getCurrentBalance() === 0) {
       setCurrentBalance(parseFloat(initialBalance));
   }


   const feedBtn = document.getElementById('feedPennyBtn');
   const petMsgEl = document.getElementById('petMessage');


   if (feedBtn) {
       feedBtn.disabled = true;
       feedBtn.textContent = 'Analyzing...';
   }
   if (petMsgEl) petMsgEl.textContent = 'Gemini is analyzing your finances...';


   try {
       // Convert to format expected by gemini-service
       const formData = {
           income: monthlyEarnings,
           spending: monthlyBudget,
           savings: initialBalance,
           debt: '0',
           monthlyInvestments: '0',
           investmentBalance: '0'
       };

       // Ask the backend/Gemini for an analysis of the high‑level finances.
       const analysis = await analyzeFinancialData(formData);

       // Persist the analysis so that deposit/withdrawal reactions can revert
       // back to these values after a short time.
       overallAnalysis = analysis;

       // Reset monthly progress since a new financial snapshot has been provided
       resetProgress();

       // Update the pet display and save state
       updatePetDisplay(analysis);
       savePetState(analysis);
       window.switchPage('petView');

       const nextMsg =
         (analysis && typeof analysis.message === 'string' && analysis.message.trim()) ||
         'Analysis complete!';
       if (petMsgEl) petMsgEl.textContent = nextMsg;

   } catch (error) {
       console.error('Feed Penny failed:', error);
       if (petMsgEl) petMsgEl.textContent = `Oops! ${error?.message || 'Something went wrong.'}`;
   } finally {
       if (feedBtn) {
           feedBtn.disabled = false;
           feedBtn.textContent = 'Feed Penny';
       }
   }
}


/* --------------------------- Deposit Handler --------------------------- */
async function handleDeposit() {
    window.__pennyTempSpeech = '';

   const depositInput = document.getElementById('depositAmount');
   const amount = parseFloat(depositInput.value);


   if (!amount || amount <= 0) {
       alert('Please enter a valid deposit amount!');
       return;
   }


   // Update balance
   const newBalance = getCurrentBalance() + amount;
   setCurrentBalance(newBalance);

   // Determine the user's financial context
   const { monthlyBudget, monthlyEarnings } = getFinancialData();
   const dailyBudget = monthlyBudget > 0 ? monthlyBudget / 30 : 0;
   const currentBal = getCurrentBalance();

   // Recompute the overall health after this deposit so the long‑term health bar
   // reflects your updated financial status. Update (or create) the global
   // analysis object and refresh the pet display. If no prior analysis exists
   // (for example, if the user hasn't fed Penny yet), synthesize a minimal
   // analysis object so the bar can still update.
   const newOverallHealth = computeOverallHealth();
   const newState = stateFromHealth(newOverallHealth);
   if (!overallAnalysis) {
     overallAnalysis = {
       state: newState,
       health: newOverallHealth,
       headline: '',
       advice: [],
       message: ''
     };
   } else {
     overallAnalysis.health = newOverallHealth;
     overallAnalysis.state  = newState;
   }
   // Update the display and persist the new long‑term state. This ensures
   // the health bar always reflects the overall portfolio after each
   // transaction.
   updatePetDisplay(overallAnalysis, false);
   savePetState(overallAnalysis);

   // Compute an effective ratio for the instant mood. We consider how
   // meaningful the deposit is relative to your current balance, your daily
   // spending budget, and your monthly earnings. To emphasize the impact
   // relative to the monthly budget, we give the daily budget ratio twice
   // the weight of the other ratios. The resulting weighted average is
   // clamped between 0 and 1 so extreme values do not overwhelm the mood.
   let totalRatio = 0;
   let weightSum  = 0;
   if (currentBal > 0) {
     totalRatio += (amount / currentBal) * 1;
     weightSum  += 1;
   }
   if (dailyBudget > 0) {
     totalRatio += (amount / dailyBudget) * 2; // double weight for budget
     weightSum  += 2;
   }
   if (monthlyEarnings > 0) {
     totalRatio += (amount / monthlyEarnings) * 1;
     weightSum  += 1;
   }
   let effectiveRatio = 0;
   if (weightSum > 0) {
     effectiveRatio = totalRatio / weightSum;
     // Cap between 0 and 1
     effectiveRatio = Math.max(0, Math.min(1, effectiveRatio));
   }

   // Determine the reaction state based on the size of the deposit.
   // Any deposit is considered a positive step, so even small amounts
   // trigger at least the 'HEALTHY' state. Larger deposits yield
   // progressively better moods.
   let reactionState;
   if (effectiveRatio >= 0.75)      reactionState = 'FANTASTIC';
   else if (effectiveRatio >= 0.50) reactionState = 'THRIVING';
   else                             reactionState = 'HEALTHY';

   // Use the base overall health for the health value during the reaction
   const baseHealth = newOverallHealth;

   // Construct a message for the reaction
   const msg = dailyBudget > 0
     ? `You deposited $${amount.toFixed(2)} which is ${(amount / dailyBudget * 100).toFixed(0)}% of your daily budget. Great job!`
     : `You deposited $${amount.toFixed(2)}! Way to grow your savings.`;

   const petReaction = {
     state: reactionState,
     health: baseHealth,
     message: msg,
    direction: 'up'


   };

   // Update progress tracker (handles day finalization rules)
   handleDepositProgress(amount);

   // Show the instantaneous reaction. Do not change the health bar during
   // the temporary mood; the bar already reflects the new overall health.
   updatePetDisplay(petReaction, true);
   // Show message in the speech bubble overlay (if available)
   try {
     if (window.pennyShowMessage) window.pennyShowMessage(msg);
   } catch {}

   // Clear input and switch to pet view so the user sees the reaction
   depositInput.value = '';
   window.switchPage('petView');
}


/* --------------------------- Withdraw Handler --------------------------- */
async function handleWithdraw() {
      window.__pennyTempSpeech = '';
   const withdrawInput = document.getElementById('withdrawAmount');
   const amount = parseFloat(withdrawInput.value);


   if (!amount || amount <= 0) {
       alert('Please enter a valid withdrawal amount!');
       return;
   }


   const currentBalance = getCurrentBalance();


   if (amount > currentBalance) {
       alert(`You can't withdraw more than your balance ($${currentBalance.toFixed(2)})!`);
       return;
   }


   // Update balance
   const newBalance = currentBalance - amount;
   setCurrentBalance(newBalance);

   // Determine the user's financial context
   const { monthlyBudget, monthlyEarnings } = getFinancialData();
   const dailyBudget = monthlyBudget > 0 ? monthlyBudget / 30 : 0;
   const currentBal = getCurrentBalance();

   // Recompute the overall health after this withdrawal so the long‑term
   // health bar reflects your updated financial situation. Update (or
   // create) the global analysis object and refresh the display. This
   // ensures the bar moves immediately after a withdrawal. If there's no
   // prior analysis (e.g. the user hasn't fed Penny), create a minimal
   // object to hold the state.
   const newOverallHealth = computeOverallHealth();
   const newState = stateFromHealth(newOverallHealth);
   if (!overallAnalysis) {
     overallAnalysis = {
       state: newState,
       health: newOverallHealth,
       headline: '',
       advice: [],
       message: ''
     };
   } else {
     overallAnalysis.health = newOverallHealth;
     overallAnalysis.state  = newState;
   }
   updatePetDisplay(overallAnalysis, false);
   savePetState(overallAnalysis);

   // Compute an effective ratio reflecting how significant this withdrawal is
   // relative to your current balance, your daily budget, and your monthly
   // earnings. To emphasize the effect of the monthly budget, we weight the
   // daily budget ratio twice as much as the others. The weighted average
   // is clamped between 0 and 1. Larger ratios produce stronger negative moods.
   let totalRatio = 0;
   let weightSum  = 0;
   if (currentBal > 0) {
     totalRatio += (amount / currentBal) * 1;
     weightSum  += 1;
   }
   if (dailyBudget > 0) {
     totalRatio += (amount / dailyBudget) * 2; // double weight for budget
     weightSum  += 2;
   }
   if (monthlyEarnings > 0) {
     totalRatio += (amount / monthlyEarnings) * 1;
     weightSum  += 1;
   }
   let effectiveRatio = 0;
   if (weightSum > 0) {
     effectiveRatio = totalRatio / weightSum;
     effectiveRatio = Math.max(0, Math.min(1, effectiveRatio));
   }

   // Determine the reaction state based on the size of the withdrawal. More
   // severe withdrawals lead to worse moods. A mild withdrawal keeps the
   // pet 'SURVIVING', while extreme withdrawals can 'FLATLINE' the pet.
   let reactionState;
   if (effectiveRatio >= 0.75) reactionState = 'ATROCIOUS';
   else if (effectiveRatio >= 0.5) reactionState = 'CRITICAL';
   else if (effectiveRatio >= 0.25) reactionState = 'STRUGGLING';
   else reactionState = 'SURVIVING';

   // Use the base overall health for the health value during the reaction
   const baseHealth = newOverallHealth;

   // Construct a message for the reaction
   const msg = dailyBudget > 0
     ? `You withdrew $${amount.toFixed(2)} which is ${(amount / dailyBudget * 100).toFixed(0)}% of your daily budget. Try to stay within your plan!`
     : `You withdrew $${amount.toFixed(2)}. Keep an eye on your spending!`;
   const petReaction = {
     state: reactionState,
     health: baseHealth,
     message: msg,
    direction: 'down'

   };

   // Update progress tracker (handles day finalization rules)
   handleWithdrawProgress(amount);

   // Show the instantaneous reaction. Do not update the health bar during
   // the temporary mood; the bar already reflects the new overall health.
   updatePetDisplay(petReaction, true);
   try {
     if (window.pennyShowMessage) window.pennyShowMessage(msg);
   } catch {}

   // Clear input and switch to pet view so the user sees the reaction
   withdrawInput.value = '';
   window.switchPage('petView');
}


/* ------------------------- Event Listeners ------------------------- */
document.addEventListener('DOMContentLoaded', () => {
   loadPetState();
   updateBalanceDisplay();


   // Load saved financial data into inputs
   const saved = getFinancialData();
   if (saved.initialBalance) document.getElementById('initialBalance').value = saved.initialBalance;
   if (saved.monthlyEarnings) document.getElementById('monthlyEarnings').value = saved.monthlyEarnings;
   if (saved.monthlyBudget) document.getElementById('monthlyBudget').value = saved.monthlyBudget;

   document.getElementById('feedPennyBtn').addEventListener('click', handleFeedPenny);
    document.getElementById('depositBtn').addEventListener('click', handleDeposit);
    document.getElementById('withdrawBtn').addEventListener('click', handleWithdraw);
    document.getElementById('resetBtn').addEventListener('click', handleReset); // ✅ move here
});


// Enter key support
document.querySelectorAll('input').forEach(input => {
   input.addEventListener('keypress', (e) => {
       if (e.key === 'Enter') {
           if (input.id === 'depositAmount') {
               handleDeposit();
           } else if (input.id === 'withdrawAmount') {
               handleWithdraw();
           } else {
               handleFeedPenny();
           }
       }
   });
});