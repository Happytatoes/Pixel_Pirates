// public/gemini-service.js
// Enhanced with instant mood vs overall health calculation

const TIMEOUT_MS = 15000;

export async function analyzeFinancialData(data) {
  try {
    const metrics = calculateMetrics(data);
    const overallHealth = calculateOverallHealth(metrics);
    const state = stateFromHealth(overallHealth);
    
    const headline = buildHeadline(state, overallHealth, metrics);
    const advice = buildAdvice(metrics);

    return {
      state,
      health: Math.round(overallHealth),
      headline,
      advice,
      message: formatMessage(headline, advice)
    };
  } catch (err) {
    console.error('analyzeFinancialData failed:', err);
    return {
      state: 'SURVIVING',
      health: 50,
      headline: 'Analysis complete.',
      advice: ['Check your numbers and try again.'],
      message: 'Analysis complete.'
    };
  }
}

export function calculateInstantReaction(data) {
  const metrics = calculateMetrics(data);
  const instantHealth = calculateInstantHealth(metrics);
  const state = stateFromHealth(instantHealth);
  
  const headline = buildInstantHeadline(metrics, instantHealth);
  const advice = [buildInstantAdvice(metrics)];

  return {
    state,
    health: Math.round(instantHealth),
    headline,
    advice,
    message: formatMessage(headline, advice),
    isInstant: true
  };
}

/* ------------------------- Metric Calculations ------------------------- */

function calculateMetrics(data) {
  const initialBalance = parseFloat(data.initialBalance) || 0;
  const currentBalance = parseFloat(data.currentBalance) || 0;
  const monthlyEarnings = parseFloat(data.monthlyEarnings) || 0;
  const monthlyBudget = parseFloat(data.monthlyBudget) || 0;
  
  const dailyDeposit = parseFloat(data.dailyDeposit) || 0;
  const dailyWithdrawal = parseFloat(data.dailyWithdrawal) || 0;
  const totalDailyChange = parseFloat(data.totalDailyChange) || 0;
  const daysPassed = Math.max(1, parseFloat(data.daysPassed) || 1);

  // Core calculations
  const balanceChange = currentBalance - initialBalance;
  const netDailyChange = dailyDeposit - dailyWithdrawal;
  const monthlyExpectedSpending = Math.abs(totalDailyChange / daysPassed);
  const dailyBudgetLimit = monthlyBudget / 30;

  return {
    initialBalance,
    currentBalance,
    monthlyEarnings,
    monthlyBudget,
    dailyDeposit,
    dailyWithdrawal,
    totalDailyChange,
    daysPassed,
    balanceChange,
    netDailyChange,
    monthlyExpectedSpending,
    dailyBudgetLimit
  };
}

/* ----------------------- Overall Health Calculation ----------------------- */

function calculateOverallHealth(m) {
  let health = 50; // Base health

  // Factor 1: Balance Change (max ±20 points)
  const balanceChangeRatio = m.initialBalance > 0 
    ? (m.balanceChange / m.initialBalance) 
    : (m.balanceChange / 1000); // If no initial balance, use $1000 as baseline
  
  if (balanceChangeRatio > 0.5) health += 20;
  else if (balanceChangeRatio > 0.25) health += 15;
  else if (balanceChangeRatio > 0.1) health += 10;
  else if (balanceChangeRatio > 0) health += 5;
  else if (balanceChangeRatio > -0.1) health -= 5;
  else if (balanceChangeRatio > -0.25) health -= 10;
  else if (balanceChangeRatio > -0.5) health -= 15;
  else health -= 20;

  // Factor 2: Daily Net Change Trend (max ±15 points)
  const avgDailyNet = m.totalDailyChange / m.daysPassed;
  if (avgDailyNet > 50) health += 15;
  else if (avgDailyNet > 20) health += 10;
  else if (avgDailyNet > 5) health += 5;
  else if (avgDailyNet > -5) health += 0;
  else if (avgDailyNet > -20) health -= 5;
  else if (avgDailyNet > -50) health -= 10;
  else health -= 15;

  // Factor 3: Spending vs Budget (max ±15 points)
  if (m.monthlyBudget > 0) {
    const spendingRatio = m.monthlyExpectedSpending / m.monthlyBudget;
    if (spendingRatio < 0.5) health += 15;
    else if (spendingRatio < 0.7) health += 10;
    else if (spendingRatio < 0.9) health += 5;
    else if (spendingRatio < 1.0) health += 0;
    else if (spendingRatio < 1.2) health -= 5;
    else if (spendingRatio < 1.5) health -= 10;
    else health -= 15;
  }

  // Factor 4: Current Balance Status (max ±10 points)
  if (m.currentBalance > m.monthlyBudget * 2) health += 10;
  else if (m.currentBalance > m.monthlyBudget) health += 5;
  else if (m.currentBalance > m.monthlyBudget * 0.5) health += 0;
  else if (m.currentBalance > 0) health -= 5;
  else health -= 10;

  return clamp(health, 0, 100);
}

/* ---------------------- Instant Health Calculation ---------------------- */

function calculateInstantHealth(m) {
  const overallHealth = calculateOverallHealth(m);
  
  // Calculate instant reaction modifier
  let modifier = 0;
  
  // Check if this action pushes spending over budget
  const projectedMonthlySpending = (m.totalDailyChange + m.netDailyChange) / (m.daysPassed + 1) * 30;
  const isOverBudget = m.monthlyBudget > 0 && projectedMonthlySpending > m.monthlyBudget;

  if (isOverBudget) {
    // NEGATIVE REACTION - Over budget
    const overAmount = projectedMonthlySpending - m.monthlyBudget;
    const overPercent = (overAmount / m.monthlyBudget) * 100;
    
    if (overPercent > 50) modifier = -30;
    else if (overPercent > 30) modifier = -20;
    else if (overPercent > 15) modifier = -15;
    else if (overPercent > 5) modifier = -10;
    else modifier = -5;
  } else {
    // POSITIVE REACTION - Within budget
    if (m.netDailyChange > 100) modifier = 30;
    else if (m.netDailyChange > 50) modifier = 20;
    else if (m.netDailyChange > 20) modifier = 15;
    else if (m.netDailyChange > 0) modifier = 10;
    else if (m.netDailyChange === 0) modifier = 0;
    else if (m.netDailyChange > -20) modifier = -5;
    else if (m.netDailyChange > -50) modifier = -10;
    else modifier = -15;
  }

  // Scale modifier based on how significant it is relative to budget
  if (m.monthlyBudget > 0) {
    const dailyImpact = Math.abs(m.netDailyChange);
    const impactRatio = dailyImpact / m.dailyBudgetLimit;
    
    if (impactRatio > 3) modifier *= 1.5; // Big transaction
    else if (impactRatio > 1.5) modifier *= 1.2; // Moderate transaction
    // else normal modifier
  }

  return clamp(overallHealth + modifier, 0, 100);
}

/* ------------------------- Message Builders ------------------------- */

function buildHeadline(state, health, m) {
  const h = Math.round(health);
  
  if (state === 'LEGENDARY') {
    return `Your pet is thriving with ${h} points! Balance is up by ${dollars(m.balanceChange)}.`;
  }
  if (state === 'THRIVING') {
    return `Your pet is doing great with ${h} points! You are staying on track.`;
  }
  if (state === 'HEALTHY') {
    return `Your pet is healthy with ${h} points. Keep up the good work.`;
  }
  if (state === 'SURVIVING') {
    return `Your pet is okay with ${h} points. There is room to improve.`;
  }
  if (state === 'STRUGGLING') {
    return `Your pet needs help with ${h} points. Check your spending.`;
  }
  if (state === 'CRITICAL') {
    return `Your pet is struggling with ${h} points. Take action now.`;
  }
  return `Your pet needs urgent care with ${h} points.`;
}

function buildInstantHeadline(m, health) {
  const h = Math.round(health);
  const amount = Math.abs(m.netDailyChange);
  
  if (m.netDailyChange > 50) {
    return `Wow! You added ${dollars(amount)} today! Score: ${h} points.`;
  }
  if (m.netDailyChange > 0) {
    return `Nice! You saved ${dollars(amount)} today! Score: ${h} points.`;
  }
  if (m.netDailyChange === 0) {
    return `You broke even today. Score: ${h} points.`;
  }
  if (m.netDailyChange > -50) {
    return `You spent ${dollars(amount)} today. Score: ${h} points.`;
  }
  return `Whoa! You spent ${dollars(amount)} today. Score: ${h} points.`;
}

function buildAdvice(m) {
  const advice = [];

  // Advice 1: What's going well
  if (m.balanceChange > 0) {
    advice.push(`Your balance grew by ${dollars(m.balanceChange)} since you started.`);
  } else if (m.netDailyChange >= 0) {
    advice.push(`You are keeping your balance steady each day.`);
  } else {
    advice.push(`Focus on small wins to build momentum.`);
  }

  // Advice 2: What needs work
  if (m.monthlyBudget > 0 && m.monthlyExpectedSpending > m.monthlyBudget) {
    const over = m.monthlyExpectedSpending - m.monthlyBudget;
    advice.push(`Your spending is ${dollars(over)} over budget this month. Cut back where you can.`);
  } else if (m.balanceChange < 0) {
    advice.push(`Your balance dropped by ${dollars(Math.abs(m.balanceChange))}. Try to deposit more than you withdraw.`);
  } else {
    advice.push(`Keep tracking your deposits and withdrawals daily.`);
  }

  // Advice 3: Next step goal
  const dailyTarget = m.monthlyBudget > 0 ? m.monthlyBudget / 30 : 50;
  advice.push(`Try to keep daily spending under ${dollars(dailyTarget)} to stay on budget.`);

  return advice;
}

function buildInstantAdvice(m) {
  const projectedMonthly = (m.totalDailyChange + m.netDailyChange) / (m.daysPassed + 1) * 30;
  
  if (m.monthlyBudget > 0 && projectedMonthly > m.monthlyBudget) {
    const over = projectedMonthly - m.monthlyBudget;
    return `This puts you ${dollars(over)} over budget for the month. Be careful!`;
  }
  
  if (m.netDailyChange > 0) {
    return `Great job! This brings your monthly projection to ${dollars(projectedMonthly * -1)} in spending.`;
  }
  
  return `Your monthly spending is now projected at ${dollars(Math.abs(projectedMonthly))}.`;
}

function formatMessage(headline, advice) {
  const bullets = advice.map(a => `• ${a}`).join('\n');
  return `${headline}\n${bullets}`;
}

/* ---------------------------- State Mapping ---------------------------- */

function stateFromHealth(h) {
  if (h >= 90) return 'LEGENDARY';
  if (h >= 75) return 'THRIVING';
  if (h >= 60) return 'HEALTHY';
  if (h >= 45) return 'SURVIVING';
  if (h >= 30) return 'STRUGGLING';
  if (h >= 15) return 'CRITICAL';
  return 'FLATLINED';
}

/* ------------------------------- Helpers ------------------------------- */

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function dollars(n) {
  return `$${Math.abs(Math.round(n))}`;
}

window.analyzeFinancialData = analyzeFinancialData;
window.calculateInstantReaction = calculateInstantReaction;