// scripts/fixLoanAmounts.js
require("dotenv").config();
const mongoose   = require("mongoose");
const Loan       = require("./models/Loan");
const LoanLedger = require("./models/LoanLedger");

const DRY_RUN = process.env.DRY_RUN !== "false"; // default: dry run — must pass DRY_RUN=false to write

async function fixLoanAmounts() {
  await mongoose.connect(process.env.DB);

  const loans = await Loan.find({});
  console.log(`Checking ${loans.length} loans...`);

  let corrected = 0, unchanged = 0, skipped = 0;

  for (const loan of loans) {
    const ledgerEntry = await LoanLedger.findOne({
      loan: loan._id,
      transactionType: "disbursement"
    });

    if (!ledgerEntry || ledgerEntry.amount == null || ledgerEntry.balanceAfter == null) {
      console.warn(`⚠️  Loan ${loan._id} [${loan.status}] — no reliable disbursement record, skipping.`);
      skipped++;
      continue;
    }

    const originalAmount     = ledgerEntry.amount;
    const originalTotalRepay = ledgerEntry.balanceAfter;

    // How much has already been paid off, inferred from how far totalRepay has drifted down
    const totalRepaidSoFar = parseFloat((originalTotalRepay - (loan.totalRepay || 0)).toFixed(2));

    if (totalRepaidSoFar <= 0) {
      unchanged++;
      continue; // nothing repaid yet — amount is already correct
    }

    const correctedAmount = Math.max(
      parseFloat((originalAmount - totalRepaidSoFar).toFixed(2)),
      0
    );

    if (correctedAmount === loan.amount) {
      unchanged++;
      continue;
    }

    console.log(
      `Loan ${loan._id} [${loan.status}]: amount ${loan.amount} → ${correctedAmount} ` +
      `(original=${originalAmount}, repaidSoFar=${totalRepaidSoFar})`
    );

    if (!DRY_RUN) {
      loan.amount = correctedAmount;
      await loan.save();
    }
    corrected++;
  }

  console.log(`\nDone. Corrected: ${corrected} | Unchanged: ${unchanged} | Skipped (no ledger): ${skipped}`);
  console.log(DRY_RUN ? "🔒 DRY RUN — nothing was saved. Re-run with DRY_RUN=false to apply." : "✅ Changes applied.");

  await mongoose.disconnect();
}

fixLoanAmounts().catch(err => { console.error("Fatal:", err); process.exit(1); });