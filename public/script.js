// script.js
import { analyzeFinancialData, calculateInstantReaction } from './gemini-service.js';

/* ----------------------------- Navigation ----------------------------- */
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

  if (pageId === 'financeView') updateBalanceDisplay();
};

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
    monthlyBudget: parseFloat(localStorage.getItem('monthlyBudget')) || 0,
    totalDailyChange: parseFloat(localStorage.getItem('totalDailyChange')) || 0,
    daysPassed: parseInt(localStorage.getItem('daysPassed')) || 0,
    lastActionType: localStorage.getItem('lastActionType') || null
  };
}

function saveFinancialData(data) {
  localStorage.setItem('initialBalance', data.initialBalance);
  localStorage.setItem('monthlyEarnings', data.monthlyEarnings);
  localStorage.setItem('monthlyBudget', data.monthlyBudget);
  if (data.totalDailyChange !== undefined) {
    localStorage.setItem('totalDailyChange', data.totalDailyChange);
  }
  if (data.daysPassed !== undefined) {
    localStorage.setItem('daysPassed', data.daysPassed);
  }
  if (data.lastActionType !== undefined) {
    localStorage.setItem('lastActionType', data.lastActionType);
  }
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

/* ---------------------------- Pet state/visuals ---------------------------- */

const PET_IMAGE_BASE = '/images';
const PET_STATES = {
  FLATLINED: { img: 'critical.webp', className: 'flatlined', name: 'FLATLINED', animation: 'pulse' },
  CRITICAL: { img: 'critical.webp', className: 'critical', name: 'CRITICAL', animation: 'bounce' },
  STRUGGLING: { img: 'struggling.webp', className: 'struggling', name: 'STRUGGLING', animation: 'pulse' },
  SURVIVING: { img: 'happy.webp', className: 'surviving', name: 'SURVIVING', animation: '' },
  HEALTHY: { img: 'happy.webp', className: 'healthy', name: 'HEALTHY', animation: '' },
  THRIVING: { img: 'thriving.webp', className: 'thriving', name: 'THRIVING', animation: 'bounce' },
  LEGENDARY: { img: 'thriving.webp', className: 'legendary', name: 'LEGENDARY', animation: 'pulse' },
  EGG: { img: 'egg.webp', className: 'egg', name: 'EGG', animation: 'bounce' }
};

// Preload images
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

let revertTimeout = null;
let overallHealthState = null;

function updatePetDisplay(analysis, isTemporary = false) {
  const petArea = document.getElementById('petArea');
  const pet = document.getElementById('pet');
  const stateName = document.getElementById('stateName');
  const petMessage = document.getElementById('petMessage');
  const stats = document.getElementById('stats');
  const healthBar = document.getElementById('healthBar');
  const healthValue = document.getElementById('healthValue');

  const stateKey = toAllowedState(analysis?.state);
  const current = PET_STATES[stateKey];

  // Store overall health if this is not temporary
  if (!isTemporary) {
    overallHealthState = analysis;
  }

  // Background / animation
  if (petArea) petArea.className = 'pet-area ' + current.className;

  // Render image
  if (pet) {
    const imgName = current.img || 'happy.webp';
    const src = `${PET_IMAGE_BASE}/${imgName}`;
    pet.className = 'pet ' + current.animation;

    let img = pet.querySelector('img.pet-img');
    if (!img) {
      pet.innerHTML = '';
      img = document.createElement('img');
      img.className = 'pet-img';
      img.width = 96;
      img.height = 96;
      img.decoding = 'async';
      img.alt = current.name;
      pet.appendChild(img);
    }
    img.src = src;
    img.alt = current.name;
  }

  if (stateName) stateName.textContent = current.name;

  // Health bar
  const health = clamp0to100(analysis?.health);
  if (typeof analysis?.health === 'number') {
    if (stats) stats.style.display = 'flex';
    if (healthBar) {
      healthBar.style.width = health + '%';
      if (health <= 20) healthBar.setAttribute('data-health', 'critical');
      else if (health <= 40) healthBar.setAttribute('data-health', 'low');
      else if (health <= 60) healthBar.setAttribute('data-health', 'medium');
      else if (health <= 80) healthBar.setAttribute('data-health', 'good');
      else healthBar.setAttribute('data-health', 'excellent');
    }
    if (healthValue) healthValue.textContent = health + '%';
  } else {
    if (stats) stats.style.display = 'none';
  }

  // Message
  const safeMsg = String(analysis?.message || '').trim();
  if (safeMsg && petMessage) petMessage.textContent = safeMsg;

  // If this is a temporary instant reaction, set timeout to revert
  if (isTemporary && overallHealthState) {
    clearTimeout(revertTimeout);
    revertTimeout = setTimeout(() => {
      updatePetDisplay(overallHealthState, false);
    }, 3000); // Revert after 3 seconds
  }
}

/* ----------------------- Feed Penny (Initial Analysis) ----------------------- */

async function handleFeedPenny() {
  const initialBalance = parseFloat(document.getElementById('initialBalance').value);
  const monthlyEarnings = parseFloat(document.getElementById('monthlyEarnings').value);
  const monthlyBudget = parseFloat(document.getElementById('monthlyBudget').value);

  if (!initialBalance && initialBalance !== 0) {
    alert('Please fill in initial balance!');
    return;
  }

  // Save to localStorage
  saveFinancialData({
    initialBalance,
    monthlyEarnings,
    monthlyBudget,
    totalDailyChange: 0,
    daysPassed: 0,
    lastActionType: null
  });

  // Set current balance to initial balance
  setCurrentBalance(initialBalance);

  const feedBtn = document.getElementById('feedPennyBtn');
  const petMsgEl = document.getElementById('petMessage');

  if (feedBtn) {
    feedBtn.disabled = true;
    feedBtn.textContent = 'Analyzing...';
  }
  if (petMsgEl) petMsgEl.textContent = 'Analyzing your finances...';

  try {
    const formData = {
      initialBalance,
      currentBalance: initialBalance,
      monthlyEarnings,
      monthlyBudget,
      dailyDeposit: 0,
      dailyWithdrawal: 0,
      totalDailyChange: 0,
      daysPassed: 1
    };

    const analysis = await analyzeFinancialData(formData);
    
    updatePetDisplay(analysis, false);
    savePetState(analysis);
    window.switchPage('petView');

    const nextMsg = (analysis && typeof analysis.message === 'string' && analysis.message.trim()) || 'Analysis complete!';
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
  const depositInput = document.getElementById('depositAmount');
  const amount = parseFloat(depositInput.value);

  if (!amount || amount <= 0) {
    alert('Please enter a valid deposit amount!');
    return;
  }

  const financialData = getFinancialData();
  
  // Determine if this completes a day (deposit after withdrawal or vice versa)
  let dailyDeposit = amount;
  let dailyWithdrawal = 0;
  let newDaysPassed = financialData.daysPassed;
  let newTotalDailyChange = financialData.totalDailyChange;

  if (financialData.lastActionType === 'withdraw') {
    // Complete the day
    newDaysPassed += 1;
    newTotalDailyChange += amount; // Add deposit to total
  } else if (financialData.lastActionType === 'deposit') {
    // Two deposits in a row means assumed 0 withdrawal yesterday
    newDaysPassed += 1;
    newTotalDailyChange += amount;
  } else {
    // First action ever
    newDaysPassed = 1;
    newTotalDailyChange = amount;
  }

  // Reset after 30 days
  if (newDaysPassed > 30) {
    newDaysPassed = 1;
    newTotalDailyChange = amount;
  }

  // Update balance
  const newBalance = getCurrentBalance() + amount;
  setCurrentBalance(newBalance);

  // Save state
  saveFinancialData({
    ...financialData,
    totalDailyChange: newTotalDailyChange,
    daysPassed: newDaysPassed,
    lastActionType: 'deposit'
  });

  // Calculate instant reaction
  const instantData = {
    initialBalance: financialData.initialBalance,
    currentBalance: newBalance,
    monthlyEarnings: financialData.monthlyEarnings,
    monthlyBudget: financialData.monthlyBudget,
    dailyDeposit: amount,
    dailyWithdrawal: 0,
    totalDailyChange: newTotalDailyChange,
    daysPassed: newDaysPassed
  };

  const instantReaction = calculateInstantReaction(instantData);
  updatePetDisplay(instantReaction, true); // Show instant reaction

  // Calculate and store overall health
  const overallAnalysis = await analyzeFinancialData(instantData);
  savePetState(overallAnalysis);

  // Clear input and switch to pet view
  depositInput.value = '';
  window.switchPage('petView');
}

/* --------------------------- Withdraw Handler --------------------------- */

async function handleWithdraw() {
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

  const financialData = getFinancialData();
  
  // Determine if this completes a day
  let dailyDeposit = 0;
  let dailyWithdrawal = amount;
  let newDaysPassed = financialData.daysPassed;
  let newTotalDailyChange = financialData.totalDailyChange;

  if (financialData.lastActionType === 'deposit') {
    // Complete the day
    newDaysPassed += 1;
    newTotalDailyChange -= amount; // Subtract withdrawal
  } else if (financialData.lastActionType === 'withdraw') {
    // Two withdrawals in a row means assumed 0 deposit yesterday
    newDaysPassed += 1;
    newTotalDailyChange -= amount;
  } else {
    // First action ever
    newDaysPassed = 1;
    newTotalDailyChange = -amount;
  }

  // Reset after 30 days
  if (newDaysPassed > 30) {
    newDaysPassed = 1;
    newTotalDailyChange = -amount;
  }

  // Update balance
  const newBalance = currentBalance - amount;
  setCurrentBalance(newBalance);

  // Save state
  saveFinancialData({
    ...financialData,
    totalDailyChange: newTotalDailyChange,
    daysPassed: newDaysPassed,
    lastActionType: 'withdraw'
  });

  // Calculate instant reaction
  const instantData = {
    initialBalance: financialData.initialBalance,
    currentBalance: newBalance,
    monthlyEarnings: financialData.monthlyEarnings,
    monthlyBudget: financialData.monthlyBudget,
    dailyDeposit: 0,
    dailyWithdrawal: amount,
    totalDailyChange: newTotalDailyChange,
    daysPassed: newDaysPassed
  };

  const instantReaction = calculateInstantReaction(instantData);
  updatePetDisplay(instantReaction, true); // Show instant reaction

  // Calculate and store overall health
  const overallAnalysis = await analyzeFinancialData(instantData);
  savePetState(overallAnalysis);

  // Clear input and switch to pet view
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
});

// Button event listeners
document.getElementById('feedPennyBtn').addEventListener('click', handleFeedPenny);
document.getElementById('depositBtn').addEventListener('click', handleDeposit);
document.getElementById('withdrawBtn').addEventListener('click', handleWithdraw);

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