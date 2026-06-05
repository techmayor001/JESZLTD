const Loan = require("./models/Loan");
const OperatingLedger = require("./models/OperatingLedger");
const Settings = require("./models/Settings");

async function backfillOperatingLedger() {
  const settings = await Settings.getSettings();
  const roiOperatingCharge = Number(settings.otherFees?.roiOperatingCharge || 10);

  const loans = await Loan.find({ status: { $in: ["approved", "active", "completed"] } })
    .populate("user", "firstName lastName")
    .populate("duration", "duration durationUnit penaltyPercentage rolloverPercentage")
    .populate({ path: "initiatedBy", model: "User", select: "_id" });

  console.log(`Found ${loans.length} approved loans`);

  let skipped = 0;
  let created = 0;

  for (const loan of loans) {
    const existing = await OperatingLedger.findOne({ relatedLoan: loan._id, type: "operating_charge" });
    if (existing) {
      console.log(`[SKIP] Loan ${loan._id} already has an OperatingLedger entry`);
      skipped++;
      continue;
    }

    const durationValue = loan.duration?.duration ?? loan.externalDuration;

    if (!durationValue) {
      console.warn(`[WARN] Loan ${loan._id} has no duration — skipping`);
      skipped++;
      continue;
    }

    const interestForLoan          = loan.interestAmount ?? (loan.amount * (loan.interestRate / 100) * durationValue);
    const companyChargeForThisLoan = interestForLoan * (roiOperatingCharge / 100);

    if (companyChargeForThisLoan <= 0) {
      console.log(`[SKIP] Loan ${loan._id} — zero charge`);
      skipped++;
      continue;
    }

    const borrowerName = loan.user
      ? `${loan.user.firstName} ${loan.user.lastName}`
      : loan.external?.borrowerName || "External Borrower";

    const ledgerUser = loan.user?._id ?? loan.initiatedBy?._id;

    const lastEntry = await OperatingLedger.findOne()
      .sort({ createdAt: -1 })
      .select("runningBalance");
    const prevBalance = lastEntry?.runningBalance ?? 0;

    await OperatingLedger.create({
      type:           "operating_charge",
      direction:      "in",
      amount:         companyChargeForThisLoan,
      runningBalance: prevBalance + companyChargeForThisLoan,
      relatedLoan:    loan._id,
      relatedUser:    ledgerUser,
      recordedBy:     ledgerUser,
      description:    `[BACKFILL] ROI operating charge (${roiOperatingCharge}%) on loan for ${borrowerName}`,
      meta: {
        loanAmount:    loan.amount,
        interestRate:  loan.interestRate,
        durationValue,
        chargePercent: roiOperatingCharge,
        totalInterest: interestForLoan,
        chargeAmount:  companyChargeForThisLoan,
        backfilled:    true
      }
    });

    console.log(`[CREATED] Loan ${loan._id} — ₦${companyChargeForThisLoan} for ${borrowerName}`);
    created++;
  }

  console.log(`\nBackfill done. Created: ${created}, Skipped: ${skipped}`);
}

module.exports = backfillOperatingLedger;