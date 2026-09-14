import { Person, PersonSummary, Transaction } from "@/types/finance";
import { roundToTwoDecimals } from "./formatters";

/**
 * Calculates financial metrics for a specific person based on all transactions.
 * - total_received: money received from this person (income)
 * - total_paid: money paid to this person (expense)
 * - net: total_received - total_paid
 */
export function calculatePersonSummary(
  person: Person,
  transactions: Transaction[]
): PersonSummary {
  let totalReceived = 0;
  let totalPaid = 0;
  let count = 0;

  for (const tx of transactions) {
    if (tx.person_id !== person.id) continue;

    count++;
    const amount = Number(tx.amount) || 0;

    if (tx.type === "income") {
      totalReceived += amount;
    } else if (tx.type === "expense") {
      totalPaid += amount;
    }
  }

  const roundedReceived = roundToTwoDecimals(totalReceived);
  const roundedPaid = roundToTwoDecimals(totalPaid);
  const net = roundToTwoDecimals(roundedReceived - roundedPaid);

  return {
    person,
    total_received: roundedReceived,
    total_paid: roundedPaid,
    net,
    transaction_count: count,
  };
}

/**
 * Calculates summaries for an array of people and sorts them by most active.
 */
export function calculateAllPeopleSummaries(
  people: Person[],
  transactions: Transaction[]
): PersonSummary[] {
  return people
    .map((p) => calculatePersonSummary(p, transactions))
    .sort((a, b) => b.transaction_count - a.transaction_count);
}
