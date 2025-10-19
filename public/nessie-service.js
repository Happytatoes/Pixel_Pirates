// nessie-service.js
// Simple client for fetching aggregated financial data from the backend.
// The backend proxy hides your Nessie API key and computes simple totals.

/**
 * Fetch aggregated financial data from the server.
 *
 * The response contains:
 *  - initialBalance: current balance across all of the customer’s accounts
 *  - monthlyEarnings: total amount of deposits in the last 30 days
 *  - monthlySpending: total amount of purchases and withdrawals in the last 30 days
 *  - totalSavings: sum of balances for savings accounts
 *  - totalDebt: sum of outstanding balances for credit accounts (as positive numbers)
 *  - monthlyInvestments: always zero (the Nessie API does not track investments)
 *  - investmentBalance: sum of balances for investment accounts
 *
 * @returns {Promise<object>} An object with the aggregated metrics.
 */
export async function fetchNessieData() {
  const resp = await fetch('/nessie-data');
  if (!resp.ok) {
    throw new Error('Failed to load Nessie data');
  }
  return await resp.json();
}