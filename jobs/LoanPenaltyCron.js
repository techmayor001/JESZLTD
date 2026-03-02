const cron = require("node-cron");
const Loan = require("../models/Loan");

// ─── Helper: build a period key for deduplication ────────────────────────────
// Returns a string that uniquely identifies the current penalty "window"
// for a given durationUnit.
//
//   months / days  →  "YYYY-MM-DD"          (one penalty per calendar day)
//   hours          →  "YYYY-MM-DD HH"       (one penalty per clock hour)
//   minutes        →  "YYYY-MM-DD HH:mm"    (one penalty per minute)
//
// All comparisons use LOCAL time so they stay in sync with how dueDate
// is stored (also local time, set by parseDateLocal in the approve route).

function currentPeriodKey(durationUnit, now = new Date()) {
  const pad = n => String(n).padStart(2, "0");

  const Y   = now.getFullYear();
  const M   = pad(now.getMonth() + 1);
  const D   = pad(now.getDate());
  const H   = pad(now.getHours());
  const min = pad(now.getMinutes());

  switch (durationUnit) {
    case "minutes": return `${Y}-${M}-${D} ${H}:${min}`;
    case "hours":   return `${Y}-${M}-${D} ${H}`;
    default:        return `${Y}-${M}-${D}`;   // months | days
  }
}

function periodKeyFor(date, durationUnit) {
  return currentPeriodKey(durationUnit, new Date(date));
}

// ─── Core penalty job ─────────────────────────────────────────────────────────
async function applyOverduePenalties() {
  const now = new Date();

  try {
    // Find all loans that are past their due date and not yet repaid/rejected.
    // Because dueDate is stored as end-of-day (23:59:59.999) local time in the
    // approve route, this comparison correctly fires only after the due day ends.
    const overdueLoans = await Loan.find({
      status:  { $in: ["approved", "overdue"] },
      dueDate: { $lt: now }
    }).populate("duration"); // LoanSettings — need durationUnit

    if (overdueLoans.length === 0) return;

    console.log(`[LoanCron] ${now.toISOString()} — checking ${overdueLoans.length} overdue loan(s)`);

    for (const loan of overdueLoans) {
      // ── Determine durationUnit ──────────────────────────────────────
      // Prefer the linked LoanSettings; fall back to "months" for external loans.
      const durationUnit = loan.duration?.durationUnit ?? "months";

      // ── Mark as overdue on first detection ──────────────────────────
      const isFirstDetection = loan.status !== "overdue";
      if (isFirstDetection) {
        loan.status    = "overdue";
        loan.overdueAt = now;
        console.log(`[LoanCron] Loan ${loan._id} marked OVERDUE`);
      }

      // ── Initialise outstandingBalance if not yet set ────────────────
      if (!loan.outstandingBalance || loan.outstandingBalance === 0) {
        loan.outstandingBalance = loan.totalRepay;
      }

      // ── Guard: only one penalty per period ──────────────────────────
      // Both thisPeriod and lastPeriod are built from LOCAL time, so they
      // are always compared on the same timezone basis.
      const thisPeriod = currentPeriodKey(durationUnit, now);
      const lastPeriod = loan.lastPenaltyAppliedAt
        ? periodKeyFor(loan.lastPenaltyAppliedAt, durationUnit)
        : null;

      if (lastPeriod === thisPeriod) {
        // Already penalised this period — save status change only if needed.
        if (isFirstDetection) await loan.save();
        continue;
      }

      // ── Apply penalty ───────────────────────────────────────────────
      // penaltyPercentage is stamped onto the loan at approval time so the
      // cron never needs to re-read LoanSettings (which could change later).
      const penaltyRate   = loan.penaltyPercentage || loan.duration?.penaltyPercentage || 0;
      const balanceBefore = loan.outstandingBalance;
      const penaltyAmount = parseFloat(((balanceBefore * penaltyRate) / 100).toFixed(2));
      const balanceAfter  = parseFloat((balanceBefore + penaltyAmount).toFixed(2));

      // Days overdue (used in the history label only)
      const daysOverdue = Math.ceil((now - new Date(loan.dueDate)) / (1000 * 60 * 60 * 24));

      // Update loan fields
      loan.outstandingBalance   = balanceAfter;
      loan.totalPenalty         = parseFloat(((loan.totalPenalty || 0) + penaltyAmount).toFixed(2));
      loan.lastPenaltyAppliedAt = now;

      // Append to history
      loan.penaltyHistory.push({
        appliedAt:     now,
        periodLabel:   `${thisPeriod} (Day ${daysOverdue} overdue)`,
        penaltyRate,
        penaltyAmount,
        balanceBefore,
        balanceAfter
      });

      loan.updatedAt = now;

      await loan.save();

      console.log(
        `[LoanCron] Penalty applied → Loan ${loan._id} | ` +
        `${penaltyRate}% on ₦${balanceBefore} = +₦${penaltyAmount} | ` +
        `New balance: ₦${balanceAfter} | Period: ${thisPeriod}`
      );
    }

  } catch (err) {
    console.error("[LoanCron] Error during penalty job:", err);
  }
}

// ─── Schedule ─────────────────────────────────────────────────────────────────
// Runs every minute.  The period-key guard inside applyOverduePenalties ensures
// day/month loans are only penalised once per calendar day regardless of how
// frequently the cron fires.

cron.schedule("* * * * *", applyOverduePenalties);

console.log("[LoanCron] Loan penalty cron started — running every minute");

module.exports = { applyOverduePenalties }; // exported for manual testing