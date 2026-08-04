const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// ROUTES IMPORT 
const LoanSettings = require("../../models/LoanSettings");
const Loan = require("../../models/Loan");
const LoanLedger = require('../../models/LoanLedger');
const CompanyLedger = require('../../models/CompanyLedger');
const CompanyROI = require("../../models/companyRoiSchema")
const LoanInvite = require("../../models/LoanInvite");
const ExtraCharge = require("../../models/ExtraCharge");
const Permission = require("../../models/Permission");
const Role = require("../../models/Role");
const KiddiesAccount = require("../../models/Kiddies/kiddiesAccount");
const Transaction = require("../../models/Transaction");
const OperatingLedger = require("../../models/OperatingLedger");






const User = require("../../models/User");
const Settings = require("../../models/Settings");
const MemberType = require("../../models/MemberType");
const Account = require("../../models/Account");
const Payment = require("../../models/Payment");


const AdminPayment = require("../../models/AdminPayment");
const Withdrawal = require("../../models/Withdrawal");
const { Service, PaymentHistory, SubscriptionStatus } = require('../../models/Servicesubscription');
const TransactionApproval = require("../../models/transactionApproval");
const {
  DepositReport,
  WithdrawalReport,
  LoanReport,
  AdminActionLog,
  SubscriptionReport,
} = require("../../models/ReportSchemas");




// ROUTES IMPORT ENDS 

// HANDLING APPROVAL OF ACCESS TO ADMIN DASHBOARD - MIDDLEWARE ------------- TECHMAYOR COMPANY LIMITED 
function ensureAdmin(requiredPermission = null) {
  return (req, res, next) => {

    // Helper: decide response type automatically
    const deny = (reason, status = 403) => {
      const wantsJSON =
        req.xhr ||                              // ajax (older)
        req.headers.accept?.includes("json") || // fetch / api
        req.headers["content-type"] === "application/json";

      if (wantsJSON) {
        return res.status(status).json({
          success: false,
          reason
        });
      }

      return res.status(status).render("auth/forbidden", {
        reason,
        user: req.user
      });
    };

    // ✅ Not authenticated
    if (!req.isAuthenticated()) {
      const wantsJSON =
        req.xhr ||
        req.headers.accept?.includes("json");

      if (wantsJSON) {
        return res.status(401).json({
          success: false,
          message: "Authentication required"
        });
      }

      return res.redirect(
        `/login?redirect=${encodeURIComponent(req.originalUrl)}`
      );
    }

    // ✅ No role
    if (!req.user.role) {
      return deny("norole");
    }

    // ✅ Role inactive
    if (!req.user.role.isActive) {
      return deny("inactive");
    }

    // ❌ Block members completely
    if (req.user.role.name === "member") {
      return deny("member");
    }

    // ✅ Permission check
    if (requiredPermission) {
      const hasPermission = req.user.role.permissions?.some(
        perm => perm.name === requiredPermission
      );

      if (!hasPermission) {
        return deny("permission");
      }
    }

    return next();
  };
}
// ENDS HERE


// LOAN LOGIC AND MANAGEMENT ---------------------- TECHMAYOR COMPANY LIMITED


// ─── Helper ───────────────────────────────────────────────────────────────────
function computeDueDate(startDate, duration, durationUnit = "months") {
  const due = new Date(startDate);
  switch (durationUnit) {
    case "minutes": due.setMinutes(due.getMinutes() + Number(duration)); break;
    case "hours":   due.setHours(due.getHours()     + Number(duration)); break;
    case "days":    due.setDate(due.getDate()        + Number(duration)); break;
    case "weeks":   due.setDate(due.getDate()        + Number(duration) * 7); break;
    case "months":
    default:        due.setMonth(due.getMonth()      + Number(duration)); break;
  }
  return due;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/manage-loan
// ─────────────────────────────────────────────────────────────────────────────
router.get("/admin/manage-loan", ensureAdmin("view_loans"), async (req, res) => {
  try {
    const loans = await Loan.find()

      // ── Borrower (internal member) ──
      .populate({
        path: "user",
        select: "firstName lastName membershipID email phone account rolloverBlocked",
        populate: {
          path: "account",
          select: "accountType balance",
          populate: {
            path: "accountType",
            model: "MemberType",
            select: "name shortCode interestRate"
          }
        }
      })


      // ── Loan duration settings ──
      .populate("duration", "duration label")

      // ── Guarantors with their account balances ──
      .populate({
        path: "guarantors.guarantor",
        select: "firstName lastName membershipID email phone account",
        populate: {
          path: "account",
          select: "balance"
        }
      })

      // ── Admin who initiated the loan (optional, for audit) ──
      .populate("initiatedBy", "firstName lastName email")

      // ── Rollover: the replacement loan this was rolled into ──
      .populate("rolledIntoLoan", "amount status createdAt")

      .sort({ createdAt: -1 });

    // ── Fetch chairman's official signature for the offer letter ──
    const chairmanRole = await Role.findOne({ name: /^chairman$/i }).select("_id");
    const chairman = chairmanRole
      ? await User.findOne({ role: chairmanRole._id }).select("firstName lastName officialSignature")
      : null;

    // ── Compute stats server-side ──────────────────────────────
    // "Active" = approved + rolled_over (both are live/disbursed loans)
    const stats = {
      pendingCount:   0,
      approvedCount:  0,   // strictly status === 'approved'
      overdueCount:   0,
      rejectedCount:  0,
      paidCount:      0,
      rolledOverCount: 0,  // status === 'rolled_over'
      activeCount:    0,   // approved + rolled_over

      // Financial sums
      activeTotalAmount:    0,   // approved + rolled_over amounts
      overdueTotalAmount:   0,
      pendingTotalAmount:   0,
      outstandingTotal:     0,   // sum of outstandingBalance across all active/overdue
      paidBackTotal:        0,   // sum of paidAmount across all loans
      totalPenaltiesCharged:0,
      grandTotal:           0,   // all loan amounts combined
    };

    loans.forEach(loan => {
      const status = (loan.status || "").toLowerCase();
      const amount = Number(loan.amount)             || 0;
      const outBal = Number(loan.outstandingBalance) || 0;
      const paid   = Number(loan.paidAmount)         || 0;
      const pen    = Number(loan.totalPenalty)        || 0;

      stats.grandTotal           += amount;
      stats.outstandingTotal     += outBal;
      stats.paidBackTotal        += paid;
      stats.totalPenaltiesCharged+= pen;

      switch (status) {
        case "pending":
          stats.pendingCount++;
          stats.pendingTotalAmount += amount;
          break;

        case "approved":
          stats.approvedCount++;
          stats.activeCount++;
          stats.activeTotalAmount += amount;
          break;

        case "rolled_over":
          stats.rolledOverCount++;
          stats.activeCount++;               // counts as active
          stats.activeTotalAmount += amount;
          break;

        case "overdue":
          stats.overdueCount++;
          stats.overdueTotalAmount += amount;
          break;

        case "rejected":
          stats.rejectedCount++;
          break;

        case "paid":
          stats.paidCount++;
          break;
      }
    });

    res.render("dashboard/admin/loan", {
      admin: req.user,
      loans,
      stats,  // available in template via <%= stats.activeCount %> etc.
      chairman,
    });

  } catch (error) {
    console.error("Error fetching loans:", error);
    res.status(500).send("Internal Server Error");
  }
});

// PATCH /api/admin/members/:userId/rollover-block
router.patch("/api/admin/members/:userId/rollover-block", ensureAdmin("approve_loans"), async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: "Member not found" });

    user.rolloverBlocked = !user.rolloverBlocked;
    await user.save();

    res.json({
      success: true,
      rolloverBlocked: user.rolloverBlocked,
      message: `Rollover ${user.rolloverBlocked ? "blocked" : "unblocked"} for ${user.firstName} ${user.lastName}`
    });
  } catch (err) {
    console.error("Rollover block toggle error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

function parseDateLocal(dateStr) {
  if (!dateStr) return null;
  if (dateStr.length > 10) return new Date(dateStr);
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date();
  d.setFullYear(year, month - 1, day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function computeDueDate(startDate, durationValue, durationUnit) {
  const due = new Date(startDate);
  switch (durationUnit) {
    case "minutes":
      due.setMinutes(due.getMinutes() + durationValue);
      break;
    case "hours":
      due.setHours(due.getHours() + durationValue);
      break;
    case "days":
      due.setDate(due.getDate() + durationValue);
      due.setHours(23, 59, 59, 999);
      break;
    case "months":
    default:
      due.setMonth(due.getMonth() + durationValue);
      due.setHours(23, 59, 59, 999);
      break;
  }
  return due;
}

// ─── POST /api/loans/approve ──────────────────────────────────────────────────
router.post("/api/loans/approve", ensureAdmin("approve_loans"), async (req, res) => {
  try {
    const { loanId, disbursementMethod, disbursementDate } = req.body;

    if (!loanId || !disbursementMethod || !disbursementDate)
      return res.status(400).json({ message: "Missing required fields." });

    const approvedBy = req.user?._id;
    if (!approvedBy)
      return res.status(401).json({ message: "Unauthorized." });

    // ═══════════════════════════════════════════════════════════════════════════
    // FETCH ONLY — do not mutate status yet. We validate everything first so a
    // failed validation never leaves the loan stuck in "approved" with stale data.
    // ═══════════════════════════════════════════════════════════════════════════
    const loan = await Loan.findOne({ _id: loanId, status: "pending" })
      .populate("duration")
      .populate("user")
      .populate({ path: "initiatedBy", model: "User", select: "_id email firstName lastName" })
      .populate("guarantors.guarantor");

    if (!loan)
      return res.status(400).json({ message: "Loan already approved or not found." });

    if (!loan.guarantors.every(g => g.status === "accepted"))
      return res.status(400).json({ message: "All guarantors must accept." });

    // ── Duration ──────────────────────────────────────────────────────────────
    const durationValue = loan.duration?.duration ?? loan.externalDuration;
    const durationUnit  = loan.duration?.durationUnit ?? "months";

    if (!durationValue)
      return res.status(400).json({ message: "Loan duration missing." });

    // ── Parse disbursement date ──────────────────────────────────────────────
    const [dy, dm, dd] = disbursementDate.split('-').map(Number);
    const parsedDisburseDate = new Date(Date.UTC(dy, dm - 1, dd, 12, 0, 0));

    // ═══════════════════════════════════════════════════════════════════════════
    // ALL VALIDATION PASSED — now it's safe to flip status to "approved"
    // ═══════════════════════════════════════════════════════════════════════════
    await Loan.updateOne(
      { _id: loan._id, status: "pending" },
      {
        $set: {
          status: "approved",
          disbursementMethod,
          disbursementDate: parsedDisburseDate,
          approvedAt: new Date(),
          updatedAt: new Date()
        }
      }
    );

    // ── Remove other pending/approved loans for this user ─────────────────────
    if (loan.user) {
      const existing = await Loan.findOne({
        user: loan.user._id,
        _id: { $ne: loan._id },
        status: { $in: ["pending", "approved"] }
      });
      if (existing) await Loan.deleteOne({ _id: existing._id });
    }

    // ── Compute dates ─────────────────────────────────────────────────────────
    const disburseDate    = parsedDisburseDate;
    const computedDueDate = computeDueDate(disburseDate, durationValue, durationUnit);

    // Optional admin override for due date — must be a valid date after disbursement
    let dueDate = computedDueDate;
    let dueDateAdjusted = false;
    if (req.body.dueDate) {
      const [y, m, d] = req.body.dueDate.split('-').map(Number);
      const parsedOverrideDueDate = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
      if (parsedOverrideDueDate && parsedOverrideDueDate > disburseDate) {
        dueDate = parsedOverrideDueDate;
        dueDateAdjusted = Math.abs(dueDate - computedDueDate) > 1000;
      }
    }

    const penaltyPercentage =
      loan.duration?.penaltyPercentage ??
      loan.penaltyPercentage ??
      0;

    const rolloverPercentage =
      loan.duration?.rolloverPercentage ??
      loan.rolloverPercentage ??
      0;

    // ═══════════════════════════════════════════════════════════════════════════
    // INTEREST RATE OVERRIDE (per-loan only — MemberType.interestRate is never
    // touched, so this only affects this one loan document)
    // ═══════════════════════════════════════════════════════════════════════════

    // Snapshot the ORIGINAL rate before any override, guarded against
    // undefined/null (older/external loans may not have it set).
    const baseRate = Number.isFinite(loan.interestRate) ? loan.interestRate : 0;

    const submittedRate = Number(req.body.interestRate);
    const finalRate = (Number.isFinite(submittedRate) && submittedRate >= 0 && submittedRate <= 100)
      ? submittedRate
      : baseRate;

    const rateChanged         = Math.abs(finalRate - baseRate) > 0.0001; // used only for logging/badges now
    const finalInterestAmount = loan.amount * (finalRate / 100) * durationValue;
    const finalTotalRepay     = loan.amount + finalInterestAmount;

    // ── Update computed fields ────────────────────────────────────────────────
    // Always write the resolved rate/amount/total — no longer gated on
    // rateChanged, so an override always persists even if the diff check
    // has edge cases (e.g. floating point, undefined originals, etc.)
    await Loan.updateOne(
      { _id: loan._id },
      {
        $set: {
          dueDate,
          penaltyPercentage,
          rolloverPercentage,
          interestRate:       finalRate,
          interestAmount:     finalInterestAmount,
          totalRepay:         finalTotalRepay,
          outstandingBalance: finalTotalRepay,
          totalPenalty: 0
        }
      }
    );

    // Keep the in-memory `loan` doc in sync so everything below (and the
    // final response payload) reflects the applied override without a re-fetch.
    loan.interestRate       = finalRate;
    loan.interestAmount     = finalInterestAmount;
    loan.totalRepay         = finalTotalRepay;
    loan.outstandingBalance = finalTotalRepay;
    loan.totalPenalty       = 0;
    loan.penaltyPercentage  = penaltyPercentage;
    loan.rolloverPercentage = rolloverPercentage;
    loan.dueDate            = dueDate;
    loan.status              = "approved";
    loan.disbursementMethod = disbursementMethod;
    loan.disbursementDate   = disburseDate;
    loan.approvedAt          = new Date();

    // ── Borrower label ────────────────────────────────────────────────────────
    const borrowerName   = loan.user
      ? `${loan.user.firstName} ${loan.user.lastName}`
      : loan.external?.borrowerName || "External Borrower";

    const isExternalLoan = !loan.user && !!loan.external;
    const ledgerUser     = loan.user?._id ?? loan.initiatedBy?._id ?? approvedBy;

    // Rate-change note for logs (uses baseRate, the true original)
    const rateNote = rateChanged
      ? ` (interest rate adjusted from ${baseRate}% to ${finalRate}%)`
      : "";

    // Due-date-change note for logs
    const dueDateNote = dueDateAdjusted
      ? ` (due date manually set to ${dueDate.toDateString()}, auto-calculated would have been ${computedDueDate.toDateString()})`
      : "";

    // ═══════════════════════════════════════════════════════════════════════════
    // LOAN LEDGER
    // ═══════════════════════════════════════════════════════════════════════════
    const ledgerEntry = await LoanLedger.create({
      loan:             loan._id,
      processedBy:      approvedBy,
      transactionType:  "disbursement",
      amount:           loan.amount,
      balanceBefore:    0,
      balanceAfter:     finalTotalRepay,
      paymentMethod:    disbursementMethod.toLowerCase(),
      member:           loan.user?._id,
      externalBorrower: loan.user ? undefined : loan.external,
      notes:            `Loan disbursed to ${borrowerName} on ${disburseDate.toISOString()}${rateNote}`
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // COMPANY LEDGER — loan_disbursement
    // ═══════════════════════════════════════════════════════════════════════════
    await CompanyLedger.create({
      type:        "loan_disbursement",
      direction:   "out",
      amount:      loan.amount,
      relatedUser: ledgerUser,
      relatedLoan: loan._id,
      description: isExternalLoan
        ? `External loan disbursed to ${borrowerName} via ${disbursementMethod}${rateNote}`
        : `Member loan disbursed to ${borrowerName} via ${disbursementMethod}${rateNote}`,
      recordedBy: approvedBy,
      meta: {
        disbursementMethod,
        disbursementDate:     disburseDate,
        dueDate,
        interestRate:         finalRate,
        originalInterestRate: baseRate,
        rateAdjusted:         rateChanged,
        totalRepay:           finalTotalRepay,
        interestAmount:       finalInterestAmount,
        penaltyPercentage,
        rolloverPercentage,
        isExternal:           isExternalLoan,
        loanLedgerId:         ledgerEntry._id
      }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // BORROWER TRANSACTION
    // ═══════════════════════════════════════════════════════════════════════════
    if (loan.user) {
      await Transaction.create({
        user:        loan.user._id,
        type:        "loan_payment",
        amount:      loan.amount,
        status:      "successful",
        method:      disbursementMethod,
        description: `Loan approved and disbursed${rateNote}`
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ADMIN ACTION LOG
    // ═══════════════════════════════════════════════════════════════════════════
    await AdminActionLog.create({
      admin:       approvedBy,
      adminRole:   req.user.role?.name || "admin",
      actionType:  "loan_approve",
      targetUser:  ledgerUser,
      targetModel: "Loan",
      targetId:    loan._id,
      description: isExternalLoan
        ? `Approved external loan of ₦${loan.amount.toLocaleString()} for ${borrowerName}${rateNote}`
        : `Approved member loan of ₦${loan.amount.toLocaleString()} for ${borrowerName}${rateNote}`,
      ipAddress:  req.ip,
      userAgent:  req.headers["user-agent"],
      status:     "success",
      meta: {
        loanId:                loan._id,
        amount:                loan.amount,
        totalRepay:            finalTotalRepay,
        interestRate:          finalRate,
        originalInterestRate:  baseRate,
        rateAdjusted:          rateChanged,
        interestAmount:        finalInterestAmount,
        disbursementMethod,
        disbursementDate:      disburseDate,
        dueDate,
        isExternal:            isExternalLoan
      }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // ROI DISTRIBUTION — uses finalInterestAmount throughout
    // ═══════════════════════════════════════════════════════════════════════════
    const settings           = await Settings.getSettings();
    const roiOperatingCharge = Number(settings.otherFees?.roiOperatingCharge || 10);
    const now                = new Date();
    const currentMonth       = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const interestForLoan          = finalInterestAmount;
    const companyChargeForThisLoan = interestForLoan * (roiOperatingCharge / 100);
    const netInterestForThisLoan   = interestForLoan - companyChargeForThisLoan;

    console.log("[ROI] finalRate:", finalRate, "baseRate:", baseRate, "rateChanged:", rateChanged);
    console.log("[ROI] finalInterestAmount:", finalInterestAmount);
    console.log("[ROI] interestForLoan:", interestForLoan);
    console.log("[ROI] companyChargeForThisLoan:", companyChargeForThisLoan);
    console.log("[ROI] netInterestForThisLoan:", netInterestForThisLoan);
    console.log("[ROI] currentMonth:", currentMonth);

    let companyRoi = await CompanyROI.findOne({ month: currentMonth });

    if (!companyRoi) {
      companyRoi = await CompanyROI.create({
        month:                  currentMonth,
        totalInterestCollected: interestForLoan,
        companyCharge:          companyChargeForThisLoan,
        netInterestForRoi:      netInterestForThisLoan,
        totalRoiDistributed:    0,
        status:                 "open",
        loanRoiHistory: [{
          loan:                 loan._id,
          interestForLoan,
          companyChargeForLoan: companyChargeForThisLoan,
          netInterestForLoan:   netInterestForThisLoan
        }]
      });
      console.log("[ROI] created new CompanyROI for month:", currentMonth);
    } else {
      companyRoi.totalInterestCollected += interestForLoan;
      companyRoi.companyCharge          += companyChargeForThisLoan;
      companyRoi.netInterestForRoi      += netInterestForThisLoan;
      companyRoi.loanRoiHistory.push({
        loan:                 loan._id,
        interestForLoan,
        companyChargeForLoan: companyChargeForThisLoan,
        netInterestForLoan:   netInterestForThisLoan
      });
      console.log("[ROI] updated existing CompanyROI for month:", currentMonth);
    }

    // ── Regular member accounts ───────────────────────────────────────────────
    const memberAccounts = await Account.find({ ownerType: "User" })
      .populate({ path: "ownerId", model: "User", select: "_id firstName lastName" });

    console.log("[ROI] memberAccounts found:", memberAccounts.length);
    memberAccounts.forEach(acc => {
      console.log(
        `  [MEMBER ACC] _id=${acc._id} ownerType=${acc.ownerType}`,
        `ownerId=${acc.ownerId?._id} balance=${acc.balance}`
      );
    });

    // ── Active kiddies accounts ───────────────────────────────────────────────
    const activeKiddies = await KiddiesAccount.find({ status: "active" })
      .populate({ path: "parent", select: "_id firstName lastName" })
      .populate({ path: "account" });

    console.log("[ROI] activeKiddies found:", activeKiddies.length);
    activeKiddies.forEach(ka => {
      console.log(
        `  [KIDDIES] _id=${ka._id} parent=${ka.parent?._id}`,
        `account=${ka.account?._id} balance=${ka.account?.balance}`
      );
    });

    // ── Unified pool ──────────────────────────────────────────────────────────
    const pool = [
      ...memberAccounts.map(acc => ({
        accountDoc:  acc,
        ownerUserId: acc.ownerId?._id,
        description: `ROI from loan ${loan._id} (${currentMonth})`
      })),
      ...activeKiddies
        .filter(ka => !!ka.account && !!ka.parent)
        .map(ka => ({
          accountDoc:  ka.account,
          ownerUserId: ka.parent._id,
          description: `ROI from loan ${loan._id} (${currentMonth}) — kiddies account (${ka.childFirstName} ${ka.childLastName})`
        }))
    ];

    console.log("[ROI] pool size:", pool.length);

    const totalCumulativeSavings = pool.reduce(
      (sum, entry) => sum + Number(entry.accountDoc?.balance || 0), 0
    );

    console.log("[ROI] totalCumulativeSavings:", totalCumulativeSavings);

    const safeMoney        = n => Math.round(n * 100) / 100;
    let   totalDistributed = 0;

    for (const entry of pool) {
      const { accountDoc, ownerUserId, description } = entry;
      const balance = Number(accountDoc?.balance || 0);

      console.log(
        `[ROI ENTRY] _id=${accountDoc?._id} ownerType=${accountDoc?.ownerType}`,
        `ownerUserId=${ownerUserId} balance=${balance}`
      );

      if (balance <= 0 || totalCumulativeSavings <= 0 || !ownerUserId) {
        console.log(
          `  [SKIP] reason: balance=${balance}`,
          `totalCumulativeSavings=${totalCumulativeSavings}`,
          `ownerUserId=${ownerUserId}`
        );
        continue;
      }

      const roundedROI = safeMoney((balance / totalCumulativeSavings) * netInterestForThisLoan);
      console.log(`  [DISTRIBUTE] ₦${roundedROI} → userId=${ownerUserId}`);

      accountDoc.monthlyRoiHistory.push({ month: currentMonth, roi: roundedROI });
      accountDoc.accumulativeROI = safeMoney((accountDoc.accumulativeROI || 0) + roundedROI);
      accountDoc.lastRoiPayout   = new Date();
      await accountDoc.save();

      totalDistributed += roundedROI;

      await Transaction.create({
        user:        ownerUserId,
        type:        "roi",
        amount:      roundedROI,
        status:      "successful",
        method:      "System Distribution",
        description
      });
    }

    console.log("[ROI] totalDistributed:", totalDistributed);

    companyRoi.totalRoiDistributed += safeMoney(totalDistributed);
    await companyRoi.save();

    if (companyChargeForThisLoan > 0) {
      await CompanyLedger.create({
        type:        "external_income",
        direction:   "in",
        amount:      companyChargeForThisLoan,
        relatedUser: ledgerUser,
        relatedLoan: loan._id,
        description: `ROI operating charge (${roiOperatingCharge}%) on loan for ${borrowerName}`,
        recordedBy:  approvedBy
      });
    }

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
      recordedBy:     approvedBy,
      description:    `ROI operating charge (${roiOperatingCharge}%) on loan for ${borrowerName}`,
      meta: {
        loanAmount:            loan.amount,
        interestRate:          finalRate,
        originalInterestRate:  baseRate,
        rateAdjusted:          rateChanged,
        durationValue,
        chargePercent:         roiOperatingCharge,
        totalInterest:         interestForLoan,
        chargeAmount:          companyChargeForThisLoan
      }
    });

    return res.status(200).json({
      message:        `Loan for ${borrowerName} approved successfully.`,
      roiDistributed: totalDistributed,
      loan,
      ledger:         ledgerEntry,
      companyRoi,
      appliedRate:      finalRate,
      originalRate:     baseRate,
      rateAdjusted:     rateChanged,
      finalTotalRepay,
      finalInterestAmount
    });

  } catch (error) {
    console.error("Error approving loan:", error);
    return res.status(500).json({ message: "Server error while approving loan." });
  }
});
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/loans/reject
// ─────────────────────────────────────────────────────────────────────────────
router.post("/api/loans/reject", ensureAdmin("reject_loans"), async (req, res) => {
  try {
    const { loanId, reason, details } = req.body;
    if (!loanId || !reason || !details)
      return res.status(400).json({ message: "Missing required fields." });

    const rejectedBy = req.user?._id;
    if (!rejectedBy) return res.status(401).json({ message: "Unauthorized." });

    const loan = await Loan.findById(loanId)
      .populate("duration")
      .populate("user")
      .populate("guarantors.guarantor");

    if (!loan) return res.status(404).json({ message: "Loan not found." });

    loan.status           = "rejected";
    loan.rejectedAt       = new Date();
    loan.rejectionReason  = reason;
    loan.rejectionDetails = details;
    await loan.save();

    const otherLoans = await Loan.find({
      user:   loan.user._id,
      _id:    { $ne: loan._id },
      status: { $in: ["pending", "approved"] }
    });
    for (const l of otherLoans) await Loan.deleteOne({ _id: l._id });

    for (const g of loan.guarantors) {
      const guarantorUser = await User.findById(g.guarantor._id);
      if (!guarantorUser) continue;
      guarantorUser.guarantorRequestStats.totalReceived += 1;
      guarantorUser.guarantorRequestStats.totalDeclined += 1;
      await guarantorUser.save();
    }

    await Transaction.create({
      user:        loan.user._id,
      type:        "loan_payment",
      amount:      loan.amount,
      status:      "declined",
      description: `Loan rejected: ${reason}`,
      reference:   `REJECT-${loan._id}`,
      method:      "loan_application"
    });

    return res.status(200).json({
      message: `Loan for ${loan.user.firstName} ${loan.user.lastName} rejected successfully.`,
      loan
    });

  } catch (error) {
    console.error("Error rejecting loan:", error);
    return res.status(500).json({ message: "Server error while rejecting loan." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/loans/rollover
// Admin or member triggers a rollover — pays the rollover fee, extends dueDate
// ─────────────────────────────────────────────────────────────────────────────
router.post("/api/loans/rollover", ensureAdmin("approve_loans"), async (req, res) => {
  try {
    const { loanId } = req.body;
    if (!loanId) return res.status(400).json({ message: "Missing loanId." });

    const loan = await Loan.findById(loanId).populate("duration");
    if (!loan) return res.status(404).json({ message: "Loan not found." });

    if (!["approved", "overdue"].includes(loan.status))
      return res.status(400).json({ message: "Only approved or overdue loans can be rolled over." });

    // ── Per-user rollover block check ──
    if (loan.user) {
      const borrower = await User.findById(loan.user).select("rolloverBlocked firstName lastName");
      if (!borrower) return res.status(404).json({ message: "Borrower not found." });
      if (borrower.rolloverBlocked) {
        return res.status(403).json({
          message: `Rollover is blocked for ${borrower.firstName} ${borrower.lastName}. Remove the block from their profile to proceed.`
        });
      }
    }

    const durationValue      = loan.duration?.duration    ?? loan.externalDuration ?? 1;
    const durationUnit       = loan.duration?.durationUnit ?? "months";
    const rolloverPercentage = loan.rolloverPercentage ?? loan.duration?.rolloverPercentage ?? 0;

    const currentBalance = loan.outstandingBalance || loan.totalRepay;
    const rolloverFee    = parseFloat(((currentBalance * rolloverPercentage) / 100).toFixed(2));
    const newBalance     = parseFloat((currentBalance + rolloverFee).toFixed(2));
    const newDueDate     = computeDueDate(new Date(), durationValue, durationUnit);

    loan.outstandingBalance = newBalance;
    loan.totalPenalty       = parseFloat(((loan.totalPenalty || 0) + rolloverFee).toFixed(2));
    loan.status             = "approved";
    loan.dueDate            = newDueDate;
    loan.rolloverCount      = (loan.rolloverCount || 0) + 1;
    loan.updatedAt          = new Date();

    loan.rolloverHistory.push({
      rolledOverAt:  new Date(),
      rolloverFee,
      balanceBefore: currentBalance,
      balanceAfter:  newBalance,
      newDueDate,
      processedBy:   req.user._id
    });

    await loan.save();

    return res.status(200).json({
      message:        "Loan rolled over successfully.",
      rolloverFee,
      newBalance,
      newDueDate,
      rolloverCount:  loan.rolloverCount
    });

  } catch (error) {
    console.error("Error rolling over loan:", error);
    return res.status(500).json({ message: "Server error during rollover." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/loans/mark-paid
// Mark a loan as fully repaid
// ─────────────────────────────────────────────────────────────────────────────
router.post("/api/loans/mark-paid", ensureAdmin("approve_loans"), async (req, res) => {
  try {
    const { loanId, amountPaid, paymentMethod } = req.body;
    if (!loanId) return res.status(400).json({ message: "Missing loanId." });

    const loan = await Loan.findById(loanId).populate("user");
    if (!loan) return res.status(404).json({ message: "Loan not found." });

    loan.status             = "paid";
    loan.outstandingBalance = 0;
    loan.updatedAt          = new Date();
    await loan.save();

    // Create repayment transaction
    if (loan.user) {
      await Transaction.create({
        user:        loan.user._id,
        type:        "loan_repayment",
        amount:      amountPaid || loan.outstandingBalance,
        status:      "successful",
        method:      paymentMethod || "cash",
        description: `Loan ${loan._id} marked as fully repaid`
      });
    }

    return res.status(200).json({ message: "Loan marked as paid.", loan });

  } catch (error) {
    console.error("Error marking loan paid:", error);
    return res.status(500).json({ message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/loans/:loanId/penalty-history
// Returns full penalty + rollover history for a loan
// ─────────────────────────────────────────────────────────────────────────────
router.get("/api/loans/:loanId/penalty-history", ensureAdmin("view_loans"), async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.loanId)
      .select("amount totalRepay outstandingBalance totalPenalty penaltyPercentage rolloverPercentage penaltyHistory rolloverHistory status dueDate overdueAt")
      .populate("user", "firstName lastName membershipID");

    if (!loan) return res.status(404).json({ message: "Loan not found." });

    return res.status(200).json({
      loan: {
        id:                 loan._id,
        borrower:           loan.user
          ? `${loan.user.firstName} ${loan.user.lastName}`
          : "External",
        originalAmount:     loan.amount,
        totalRepay:         loan.totalRepay,
        outstandingBalance: loan.outstandingBalance,
        totalPenalty:       loan.totalPenalty,
        penaltyPercentage:  loan.penaltyPercentage,
        rolloverPercentage: loan.rolloverPercentage,
        status:             loan.status,
        dueDate:            loan.dueDate,
        overdueAt:          loan.overdueAt
      },
      penaltyHistory:  loan.penaltyHistory,
      rolloverHistory: loan.rolloverHistory
    });

  } catch (error) {
    console.error("Error fetching penalty history:", error);
    return res.status(500).json({ message: "Server error." });
  }
});





/**
 * Send loan repayment reminder email via Brevo HTTP API
 */
async function sendLoanReminderEmail({ email, firstName, loanAmount, outstandingBalance, dueDate, daysLeft, membershipID }) {
  const isOverdue = daysLeft < 0;
  const daysText = isOverdue
    ? `${Math.abs(daysLeft)} day(s) overdue`
    : daysLeft === 0
      ? "due today"
      : `${daysLeft} day(s) remaining`;

  const fmtMoney = n => '₦' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 });
  const fmtDate  = d => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": process.env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: {
        name: process.env.BREVO_SENDER_NAME || "Club De Stars Cooperative",
        email: process.env.BREVO_SENDER_EMAIL,
      },
      to: [{ email }],
      subject: isOverdue
        ? `URGENT: Your loan repayment is overdue — Club De Stars`
        : `Reminder: Loan repayment due ${daysText} — Club De Stars`,
      htmlContent: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f8fafc;">
          <div style="background:linear-gradient(135deg,${isOverdue ? '#dc2626,#991b1b' : '#1e3a8a,#3b82f6'});border-radius:16px;padding:28px;text-align:center;">
            <h1 style="color:#fff;font-size:20px;margin:0;">CLUB DE STARS</h1>
            <p style="color:${isOverdue ? '#fecaca' : '#dbeafe'};font-size:12px;margin:4px 0 0;">Multipurpose Cooperative Society Ltd</p>
          </div>
          <div style="background:#fff;border-radius:16px;padding:28px;margin-top:16px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
            <h2 style="color:${isOverdue ? '#991b1b' : '#111827'};font-size:18px;margin:0 0 12px;">
              ${isOverdue ? '⚠️ Loan Repayment Overdue' : 'Loan Repayment Reminder'}
            </h2>
            <p style="color:#4b5563;font-size:14px;line-height:1.6;">
              Hi ${firstName || "there"}, this is a reminder regarding your active loan with Club De Stars Cooperative (Membership ID: ${membershipID || 'N/A'}).
            </p>
            <div style="background:${isOverdue ? '#fef2f2' : '#eff6ff'};border:1px solid ${isOverdue ? '#fecaca' : '#bfdbfe'};border-radius:10px;padding:18px;margin:20px 0;">
              <table style="width:100%;font-size:13px;color:#374151;border-collapse:collapse;">
                <tr><td style="padding:4px 0;">Loan Amount</td><td style="text-align:right;font-weight:700;">${fmtMoney(loanAmount)}</td></tr>
                <tr><td style="padding:4px 0;">Outstanding Balance</td><td style="text-align:right;font-weight:700;color:${isOverdue ? '#dc2626' : '#1e40af'};">${fmtMoney(outstandingBalance)}</td></tr>
                <tr><td style="padding:4px 0;">Due Date</td><td style="text-align:right;font-weight:700;">${fmtDate(dueDate)}</td></tr>
                <tr><td style="padding:4px 0;">Status</td><td style="text-align:right;font-weight:700;color:${isOverdue ? '#dc2626' : '#d97706'};">${daysText}</td></tr>
              </table>
            </div>
            <p style="color:#4b5563;font-size:14px;line-height:1.6;">
              ${isOverdue
                ? 'Please settle your outstanding balance as soon as possible to avoid further penalties. Contact the cooperative office if you need assistance.'
                : 'Please ensure your repayment is made on or before the due date to avoid late penalties.'}
            </p>
          </div>
          <p style="text-align:center;color:#9ca3af;font-size:11px;margin-top:16px;">
            Club De Stars Multipurpose Cooperative Society Ltd · Powered by JESZ LTD
          </p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Brevo send failed: ${res.status} ${errBody}`);
  }
}





// ─────────────────────────────────────────────
// Send Loan Repayment Reminder
// ─────────────────────────────────────────────
router.post("/api/loans/:id/reminder", ensureAdmin("view_loans"), async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id).populate("user", "firstName email membershipID");

    if (!loan) {
      return res.status(404).json({ message: "Loan not found." });
    }

    if (!loan.user) {
      return res.status(400).json({ message: "This loan has no internal member to notify (external/company loan)." });
    }

    if (!loan.user.email) {
      return res.status(400).json({ message: "Member has no email on file." });
    }

    if (!loan.dueDate) {
      return res.status(400).json({ message: "Loan has no due date set yet." });
    }

    const daysLeft = Math.ceil((new Date(loan.dueDate) - new Date()) / (1000 * 60 * 60 * 24));

    await sendLoanReminderEmail({
      email: loan.user.email,
      firstName: loan.user.firstName,
      loanAmount: loan.amount,
      outstandingBalance: loan.outstandingBalance || loan.totalRepay || loan.amount,
      dueDate: loan.dueDate,
      daysLeft,
      membershipID: loan.user.membershipID,
    });

    res.json({
      success: true,
      message: `Reminder sent to ${loan.user.email} successfully.`,
    });
  } catch (err) {
    console.error("Send loan reminder error:", err);
    res.status(500).json({ message: "Failed to send reminder email." });
  }
});































// EXTERNAL LOANS LOGIC AND MANAGEMENT 

router.get("/admin/external-loans", ensureAdmin("view_external_loans"), async (req, res) => {
  try {
    const loans = await Loan.find({ external: { $exists: true } })
      .populate({
        path: "user",
        select: "firstName lastName membershipID email phone account",
        populate: {
          path: "account",
          select: "accountType",
          populate: { path: "accountType", model: "MemberType", select: "name" }
        }
      })
      // Select both fullName (Admin model) and firstName+lastName (User model)
      // so the template can fall through to whichever is populated
      .populate({ path: "initiatedBy", select: "fullName firstName lastName email role" })
      .populate("duration")
      .populate({ path: "guarantors.guarantor", select: "firstName lastName membershipID email phone" })
      .sort({ createdAt: -1 });

    const users = await User.find().select("firstName lastName membershipID email phone");

    // Deep-populate loan.external and loan.user inside each payment so the
    // payments table and export can safely reference payment.loan.external.borrowerName
    // and payment.loan.user.membershipID without crashing on null.
    const payments = await Payment.find({ loan: { $in: loans.map(l => l._id) } })
      .populate({
        path: "loan",
        select: "external user amount totalRepay paidAmount interestRate dueDate status",
        populate: {
          path: "user",
          select: "firstName lastName membershipID email"
        }
      })
      .populate({ path: "paidBy", select: "fullName firstName lastName email" })
      .sort({ createdAt: -1 })
      .limit(10);

    res.render("dashboard/admin/external-loans", { admin: req.user, loans, users, payments });
  } catch (error) {
    console.error("Error fetching external loans:", error);
    res.status(500).send("Internal Server Error");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/external-loans
// Issue a loan directly (admin fills in all details)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/admin/external-loans", ensureAdmin("issue_external_loans"), async (req, res) => {
  try {
    const {
      borrowerName, borrowerPhone, borrowerEmail, borrowerType, borrowerAddress,
      loanAmount, interestRate, loanDuration, dueDate, loanPurpose,
      guarantor1, guarantor2
    } = req.body;

    if (!borrowerName || !borrowerPhone || !borrowerType || !loanAmount || !interestRate || !loanDuration || !dueDate) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!guarantor1 || !guarantor2) {
      return res.status(400).json({ error: "Both guarantors are required" });
    }
    if (guarantor1 === guarantor2) {
      return res.status(400).json({ error: "Guarantors cannot be the same person" });
    }

    const amount     = parseFloat(loanAmount);
    const rate       = parseFloat(interestRate);
    const duration   = parseInt(loanDuration, 10);
    const interest   = amount * (rate / 100) * duration;
    const totalRepay = amount + interest;

    const newLoan = new Loan({
      external: { borrowerType, borrowerName, email: borrowerEmail, phone: borrowerPhone, address: borrowerAddress },
      initiatedBy:      req.user._id,
      amount,
      totalRepay,
      interestRate:     rate,
      externalDuration: duration,
      dueDate,
      guarantors:       [{ guarantor: guarantor1 }, { guarantor: guarantor2 }],
      status:           "pending",
      purpose:          loanPurpose
    });

    await newLoan.save();

    await Promise.all([guarantor1, guarantor2].map(async (gid) => {
      const gUser = await User.findById(gid);
      if (!gUser) return;
      gUser.guarantorRequests.push({ borrower: req.user._id, loan: newLoan._id, amount, status: "pending" });
      gUser.guarantorRequestStats.totalReceived += 1;
      await gUser.save();
    }));

    res.status(201).json({
      message: "External loan issued successfully. Awaiting guarantor approval.",
      loan: newLoan
    });
  } catch (error) {
    console.error("Error issuing external loan:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/external-loans/invites  ← MUST be before /:loanId/details
// List all invite links for the admin panel table
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/admin/external-loans/invites",
  ensureAdmin("issue_external_loans"),
  async (req, res) => {
    try {
      const invites = await LoanInvite.find()
        .populate("generatedBy", "fullName email")
        .populate("loan", "amount status createdAt")
        .sort({ createdAt: -1 });

      const now = new Date();
      const enriched = invites.map((inv) => {
        const obj = inv.toObject();
        // Include the full shareable link so the frontend copy button works
        obj.link = `${process.env.BASE_URL}/apply/external-loan/${inv.token}`;
        // Compute real status (active invites past expiry surface as 'expired')
        obj.computedStatus =
          inv.status === "active" && now > inv.expiresAt ? "expired" : inv.status;
        return obj;
      });

      res.json({ invites: enriched });
    } catch (err) {
      console.error("Error fetching invites:", err);
      res.status(500).json({ error: "Failed to fetch invites." });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/external-loans/invite  ← MUST be before /:loanId/details
// Generate a secure one-time application link.
// Supports optional preset loan terms + penalty/rollover percentages.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/admin/external-loans/invite",
  ensureAdmin("issue_external_loans"),
  async (req, res) => {
    try {
      const {
        presetAmount, presetInterestRate, presetDuration,
        penaltyPercentage, rolloverPercentage, label
      } = req.body;

      const invite = new LoanInvite({
        generatedBy:        req.user._id,
        presetAmount:       presetAmount       || null,
        presetInterestRate: presetInterestRate || null,
        presetDuration:     presetDuration     || null,
        // Only set if explicitly provided (empty string → null)
        penaltyPercentage:  penaltyPercentage  != null && penaltyPercentage  !== "" ? parseFloat(penaltyPercentage)  : null,
        rolloverPercentage: rolloverPercentage != null && rolloverPercentage !== "" ? parseFloat(rolloverPercentage) : null,
        label:              label              || null
      });

      await invite.save();

      const link = `${process.env.BASE_URL}/apply/external-loan/${invite.token}`;

      res.status(201).json({
        message:   "Loan application link generated successfully.",
        token:     invite.token,
        link,
        expiresAt: invite.expiresAt
      });
    } catch (err) {
      console.error("Error generating loan invite:", err);
      res.status(500).json({ error: "Failed to generate invite link." });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /admin/external-loans/invite/:token  ← MUST be before /:loanId/details
//   ?permanent=true  →  hard-delete (only for non-active invites)
//   (no param)        →  soft-revoke (marks as 'revoked')
// ─────────────────────────────────────────────────────────────────────────────
router.delete(
  "/admin/external-loans/invite/:token",
  ensureAdmin("issue_external_loans"),
  async (req, res) => {
    try {
      const invite = await LoanInvite.findOne({ token: req.params.token });
      if (!invite) return res.status(404).json({ error: "Invite not found." });

      // Hard delete
      if (req.query.permanent === "true") {
        if (invite.status === "active") {
          return res.status(400).json({
            error: "Cannot permanently delete an active link. Revoke it first."
          });
        }
        await LoanInvite.deleteOne({ _id: invite._id });
        return res.json({ message: "Invite record permanently deleted." });
      }

      // Soft revoke
      if (invite.status === "used") {
        return res.status(400).json({ error: "Cannot revoke a link that has already been used." });
      }
      if (invite.status !== "active") {
        return res.status(400).json({ error: `Cannot revoke a link with status: ${invite.status}.` });
      }

      invite.status = "revoked";
      await invite.save();

      res.json({ message: "Invite revoked successfully." });
    } catch (err) {
      console.error("Error with invite deletion/revocation:", err);
      res.status(500).json({ error: "Failed to process request." });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/external-loans/:loanId/details  ← parameterized route LAST
// Fetch a single external loan for the details modal (includes payment history)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/admin/external-loans/:loanId/details",
  ensureAdmin("view_external_loans"),
  async (req, res) => {
    try {
      const loan = await Loan.findById(req.params.loanId)
        .populate({ path: "guarantors.guarantor", select: "firstName lastName membershipID email phone" })
        .populate({ path: "initiatedBy", select: "fullName email" });

      if (!loan || !loan.external) {
        return res.status(404).json({ error: "External loan not found." });
      }

      // Fetch payment history for this loan
      const paymentHistory = await Payment.find({ loan: loan._id })
        .sort({ createdAt: -1 })
        .limit(20)
        .populate("paidBy", "fullName email")
        .select("amount reference status type createdAt payeeName paidBy");

      res.json({ ...loan.toObject(), paymentHistory });
    } catch (err) {
      console.error("Error fetching loan details:", err);
      res.status(500).json({ error: "Failed to load loan details." });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /apply/external-loan/:token  (PUBLIC)
// Render the application form for the applicant
// ─────────────────────────────────────────────────────────────────────────────
router.get("/apply/external-loan/:token", async (req, res) => {
  try {
    const invite = await LoanInvite.findOne({ token: req.params.token })
      .populate("generatedBy", "fullName");

    if (!invite) {
      return res.render("dashboard/admin/loan-apply-invalid", {
        reason: "This application link is invalid or does not exist."
      });
    }

    if (new Date() > invite.expiresAt || invite.status !== "active") {
      return res.render("dashboard/admin/loan-apply-invalid", {
        reason:
          invite.status === "used"    ? "This application link has already been used."  :
          invite.status === "revoked" ? "This application link has been revoked."       :
                                        "This application link has expired."
      });
    }

    const users = await User.find().select("firstName lastName membershipID phone");

    res.render("dashboard/admin/loan-apply", { invite, users, token: req.params.token });
  } catch (err) {
    console.error("Error loading loan application:", err);
    res.status(500).send("Something went wrong. Please contact support.");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /apply/external-loan/:token  (PUBLIC)
// Applicant submits the completed loan application
// ─────────────────────────────────────────────────────────────────────────────
router.post("/apply/external-loan/:token", async (req, res) => {
  try {
    const invite = await LoanInvite.findOne({ token: req.params.token });

    if (!invite || invite.status !== "active" || new Date() > invite.expiresAt) {
      return res.status(400).json({
        error: "This application link is invalid, expired, or has already been used."
      });
    }

    const {
      borrowerName, borrowerPhone, borrowerEmail, borrowerType, borrowerAddress,
      loanAmount, interestRate, loanDuration, dueDate, loanPurpose,
      guarantor1, guarantor2
    } = req.body;

    if (!borrowerName || !borrowerPhone || !borrowerType || !loanAmount || !interestRate || !loanDuration || !dueDate) {
      return res.status(400).json({ error: "Please fill in all required fields." });
    }
    if (!guarantor1 || !guarantor2) {
      return res.status(400).json({ error: "Two guarantors are required." });
    }
    if (guarantor1 === guarantor2) {
      return res.status(400).json({ error: "Guarantors must be two different people." });
    }

    const amount   = parseFloat(loanAmount);
    const rate     = parseFloat(interestRate);
    const duration = parseInt(loanDuration, 10);

    // Admin preset values take priority — applicant cannot override them
    const finalAmount   = invite.presetAmount       || amount;
    const finalRate     = invite.presetInterestRate || rate;
    const finalDuration = invite.presetDuration     || duration;

    const interest   = finalAmount * (finalRate / 100) * finalDuration;
    const totalRepay = finalAmount + interest;

    const newLoan = new Loan({
      external: {
        borrowerType, borrowerName,
        email:   borrowerEmail,
        phone:   borrowerPhone,
        address: borrowerAddress
      },
      initiatedBy:        invite.generatedBy,  // admin who generated the link
      amount:             finalAmount,
      totalRepay,
      interestRate:       finalRate,
      externalDuration:   finalDuration,
      dueDate,
      guarantors:         [{ guarantor: guarantor1 }, { guarantor: guarantor2 }],
      status:             "pending",
      purpose:            loanPurpose,
      // Copy penalty & rollover from the invite onto the loan so cron jobs
      // and approval logic can use them without looking up the invite
      penaltyPercentage:  invite.penaltyPercentage  ?? 0,
      rolloverPercentage: invite.rolloverPercentage ?? 0
    });

    await newLoan.save();

    // Guarantor requests — use the initiating admin as the borrower reference
    // to satisfy the required 'borrower' field. Actual borrower details live in loan.external.
    const borrowerRef = invite.generatedBy;

    await Promise.all([guarantor1, guarantor2].map(async (gid) => {
      const gUser = await User.findById(gid);
      if (!gUser) return;
      gUser.guarantorRequests.push({
        borrower: borrowerRef,
        loan:     newLoan._id,
        amount:   finalAmount,
        status:   "pending"
      });
      gUser.guarantorRequestStats.totalReceived += 1;
      await gUser.save();
    }));

    // Mark invite as used — cannot be submitted again
    invite.status = "used";
    invite.loan   = newLoan._id;
    await invite.save();

    res.status(201).json({
      message: "Your loan application has been submitted successfully. You will be contacted once it is reviewed."
    });
  } catch (err) {
    console.error("Error submitting loan application:", err);
    res.status(500).json({ error: "Failed to submit application. Please try again." });
  }
});























// LOAN SETTINGS LOGIC 
router.get("/admin/loan/settings", ensureAdmin("manage_loan_settings"), async (req, res) => {
  try {
    const loanSettings = await LoanSettings.find().sort({ loanName: 1 });
    res.render("dashboard/admin/loan-settings", { admin: req.user, loanSettings });
  } catch (error) {
    console.error("Error fetching loan settings:", error);
    res.status(500).send("Internal Server Error");
  }
});

router.post("/api/loan/settings/add", ensureAdmin("create_loan_settings"), async (req, res) => {
  try {
    const { id, loanName, duration, durationUnit, penaltyPercentage, rolloverPercentage, eligibilityUnit, eligibilityValue, status } = req.body;

    if (id) {
      const updated = await LoanSettings.findByIdAndUpdate(
        id,
        { loanName, duration, durationUnit: durationUnit || "months", penaltyPercentage, rolloverPercentage, eligibilityUnit, eligibilityValue, status: status === "active" ? "active" : "inactive", updatedAt: Date.now() },
        { new: true }
      );
      if (!updated) return res.json({ status: false, message: "Loan setting not found" });
      return res.json({ status: true, message: "Loan setting updated successfully", updated });
    }

    const newSetting = new LoanSettings({ loanName, duration, durationUnit: durationUnit || "months", penaltyPercentage, rolloverPercentage, eligibilityUnit, eligibilityValue, status: status === "active" ? "active" : "inactive", updatedAt: Date.now() });
    await newSetting.save();
    return res.json({ status: true, message: "Loan setting added successfully", newSetting });

  } catch (error) {
    console.error("Error saving loan setting:", error);
    return res.json({ status: false, message: "Failed to save loan setting" });
  }
});

router.post("/api/loan/settings/toggle", ensureAdmin("manage_loan_settings"), async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.json({ status: false, message: "Missing setting ID" });
    const setting = await LoanSettings.findById(id);
    if (!setting) return res.json({ status: false, message: "Setting not found" });
    setting.status    = setting.status === "active" ? "inactive" : "active";
    setting.updatedAt = Date.now();
    await setting.save();
    return res.json({ status: true, message: `Setting ${setting.status === "active" ? "activated" : "deactivated"} successfully`, newStatus: setting.status });
  } catch (error) {
    console.error("Toggle setting error:", error);
    return res.json({ status: false, message: "Failed to toggle setting" });
  }
});

router.post("/api/loan/settings/delete", ensureAdmin("delete_loan_settings"), async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).send("Invalid setting ID");
    await LoanSettings.findByIdAndDelete(id);
    res.redirect("/admin/loan/settings");
  } catch (error) {
    console.error("Error deleting loan setting:", error);
    res.status(500).send("Failed to delete loan setting");
  }
});








router.get(
  "/admin/loan-payments",
  ensureAdmin("view_deposits"),
  async (req, res) => {
    try {

      // ═══════════════════════════════════════════════════════════════════════
      // 1. FETCH — query Payment, not LoanLedger
      // ═══════════════════════════════════════════════════════════════════════
      const loanPayments = await Payment.find({
        loanId: { $exists: true, $ne: null },
      })
        .populate({
          path:   "user",
          select: "firstName lastName membershipID email",
        })
        .populate({
          path:   "loanId",
          select: "amount totalRepay outstandingBalance paidAmount status external dueDate totalPenalty interestAmount",
        })
        .sort({ createdAt: -1 });

      // ═══════════════════════════════════════════════════════════════════════
      // 2. SHAPE
      // ═══════════════════════════════════════════════════════════════════════

      /* ── All reference prefixes that mean the amount is stored in naira,
            not kobo. Paystack stores amounts in kobo and requires /100;
            every manual / cooperative / rollover path stores naira directly.
      ── */
      const MANUAL_PREFIXES = [
        "COOP-",
        "LOAN-MANUAL-",
        "LOAN-INT-",
        "EXT-LOAN-",
        "ROLLOVER-",    // ← was missing — caused 5000 to show as 50
        "PENALTY-",
        "APPR-",        // admin payment approval flow
      ];

      /* ── Payment methods that are always manual (naira) ── */
      const MANUAL_METHODS = ["Manual", "Cash", "Bank Transfer", "manual", "cooperative"];

      const payments = loanPayments.map((payment) => {
        const dateObj = new Date(payment.createdAt);
        const loan    = payment.loanId;

        // ── Determine if this is a manual (naira) or Paystack (kobo) payment ──
        const isManual =
          MANUAL_METHODS.includes(payment.method) ||
          MANUAL_METHODS.includes(payment.paymentType) ||
          MANUAL_PREFIXES.some((prefix) => (payment.reference || "").startsWith(prefix)) ||
          payment.type === "rollover_request" ||       // explicit guard for rollover type
          payment.paymentType === "rollover_request";

        // Amount is in naira for manual, kobo for Paystack
        const amount = isManual ? payment.amount : payment.amount / 100;

        // ── Borrower identity ────────────────────────────────────────────
        const isExternal   = !payment.user && !!loan?.external?.borrowerName;
        const borrowerName = isExternal
          ? loan.external.borrowerName
          : payment.user
            ? `${payment.user.firstName} ${payment.user.lastName}`
            : "Unknown";

        // ── Transaction type ─────────────────────────────────────────────
        let transactionType = "repayment";
        const ref  = payment.reference || "";
        const ptype = payment.type || payment.paymentType || "";

        if      (ptype === "rollover_request" || ptype === "loan_rollover" || ref.startsWith("ROLLOVER-")) transactionType = "rollover";
        else if (ptype === "loan_interest"    || ref.startsWith("LOAN-INT-"))                              transactionType = "interest";
        else if (ptype === "loan_penalty"     || ref.startsWith("PENALTY-"))                              transactionType = "penalty";

        // ── Status normalisation ─────────────────────────────────────────
       const status =
        payment.status === "paid" || payment.status === "success" ? "approved"
        : payment.status === "failed" || payment.status === "rejected" ? "rejected"
        : "pending";

        // ── Breakdown — prefer top-level fields, fall back to meta ────────
        // Some payment types (e.g. rollover_request) store breakdown inside
        // payment.meta rather than at the top level.
        const meta          = payment.meta || {};
        const principalPaid = payment.principalPaid ?? meta.principalPaid ?? 0;
        const interestPaid  = payment.interestPaid  ?? meta.interestPaid  ?? 0;
        const penaltyPaid   = payment.penaltyPaid   ?? meta.penaltyPaid   ?? 0;

        // ── Loan balance snapshot ────────────────────────────────────────
        // For rollover types the outstanding is captured in meta; for others
        // use the live loan doc.
        const outstandingAtRequest = meta.outstandingAtRequest ?? loan?.outstandingBalance ?? null;
        const balanceBefore = outstandingAtRequest != null ? outstandingAtRequest : null;
        const balanceAfter  = balanceBefore != null ? Math.max(0, balanceBefore - amount) : null;

        // ── Payment method label ─────────────────────────────────────────
        const paymentMethodLabel =
          meta.paymentMethod
            ? meta.paymentMethod.charAt(0).toUpperCase() + meta.paymentMethod.slice(1)
            : isManual
              ? "Manual Transfer"
              : "Paystack";

        return {
          id:           payment._id.toString(),
          reference:    payment.reference || "—",
          loanRef:      loan?._id?.toString()?.slice(-8).toUpperCase() || "—",

          date: dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
          time: dateObj.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),

          borrowerName,
          borrowerType:  isExternal ? "external" : "member",
          memberId:      payment.user?.membershipID || "—",
          email: isExternal
            ? loan?.external?.email || "—"
            : payment.user?.email || payment.email || "—",

          transactionType,
          paymentMethod: paymentMethodLabel,

          amount,

          principalPaid,
          interestPaid,
          penaltyPaid,

          balanceBefore,
          balanceAfter,

          status,
          notes:
            payment.paystackResponse?.adminNote ||
            payment.paystackResponse?.message   ||
            payment.notes                       ||
            "Loan payment",
        };
      });

      // ═══════════════════════════════════════════════════════════════════════
      // 3. STATS
      // ═══════════════════════════════════════════════════════════════════════
      const approved = payments.filter((p) => p.status === "approved");

      const totalRepaid = approved
        .filter((p) => ["repayment", "interest", "penalty", "rollover"].includes(p.transactionType))
        .reduce((sum, p) => sum + p.amount, 0);

      const totalPenalties = approved
        .filter((p) => p.transactionType === "penalty")
        .reduce((sum, p) => sum + p.amount, 0);

      const pendingCount = payments.filter((p) => p.status === "pending").length;

      const now        = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const rolloversCount = loanPayments.filter(
        (p) =>
          (p.type === "loan_rollover" || p.type === "rollover_request" || (p.reference || "").startsWith("ROLLOVER-")) &&
          new Date(p.createdAt) >= monthStart
      ).length;

      // ═══════════════════════════════════════════════════════════════════════
      // 4. RENDER
      // ═══════════════════════════════════════════════════════════════════════
      res.render("dashboard/admin/loan-payments", {
        admin: req.user,
        payments,
        stats: { totalRepaid, totalPenalties, pendingCount, rolloversCount },
      });

    } catch (error) {
      console.error("Error fetching loan payments:", error);
      res.status(500).send("Internal Server Error");
    }
  }
);

router.post(
  "/admin/loans/:id/approve-payment",
  ensureAdmin("process_deposits"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { notes } = req.body;

      // ═══════════════════════════════════════════════════════════════════════
      // 1. ATOMIC PAYMENT APPROVAL
      // ═══════════════════════════════════════════════════════════════════════
      const payment = await Payment.findOneAndUpdate(
        {
          _id:    id,
          status: { $nin: ["success", "paid"] },
        },
        {
          $set: {
            status: "success",
            "paystackResponse.adminNote":  notes || "Approved by admin",
            "paystackResponse.approvedAt": new Date(),
          },
        },
        { new: true }
      ).populate({
        path:     "user",
        populate: { path: "account" },
      });

      if (!payment) {
        return res.status(400).json({ message: "Payment already approved or not found" });
      }

      if (!payment.loanId) {
        return res.status(400).json({ message: "This payment is not a loan payment. Use the deposit approval route." });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 2. ROLLOVER REQUEST — creates a new loan, exact mirror of /api/loans/approve
      // ═══════════════════════════════════════════════════════════════════════
      if (payment.type === "rollover_request" || payment.paymentType === "rollover_request") {

        const oldLoan = await Loan.findOne({
          _id:    payment.loanId,
          status: { $in: ["approved", "overdue"] }
        })
          .populate("duration")
          .populate("user")
          .populate({ path: "initiatedBy", model: "User", select: "_id email firstName lastName" })
          .populate("guarantors.guarantor");

        if (!oldLoan) {
          return res.status(404).json({ message: "Original loan not found or inactive." });
        }

        const meta            = payment.meta || {};
        const penaltyPaid     = Number(meta.penaltyPaid  || 0);
        const interestPaid    = Number(meta.interestPaid || 0);
        const payPenalty      = !!meta.payPenalty;
        const newInterestRate = Number(meta.newInterestRate || oldLoan.interestRate);
        const principal       = oldLoan.amount;

        // ── New base ─────────────────────────────────────────────────────────
        // penalty paid → base = principal only
        // penalty skipped → base = principal + carried-forward penalty
        const newBase = payPenalty
          ? principal
          : parseFloat((principal + (oldLoan.totalPenalty || 0)).toFixed(2));

        // ── New interest = newBase × newInterestRate% ─────────────────────────
        const newInterestAmt = parseFloat((newBase * (newInterestRate / 100)).toFixed(2));
        const newTotalRepay  = parseFloat((newBase + newInterestAmt).toFixed(2));

        // ── Duration — same as original loan ─────────────────────────────────
        const durationValue = oldLoan.duration?.duration ?? oldLoan.externalDuration;
        const durationUnit  = oldLoan.duration?.durationUnit ?? "months";

        if (!durationValue) {
          return res.status(400).json({ message: "Loan duration missing on original loan." });
        }

        const penaltyPct  = oldLoan.duration?.penaltyPercentage  ?? oldLoan.penaltyPercentage  ?? 0;
        const rolloverPct = oldLoan.duration?.rolloverPercentage ?? oldLoan.rolloverPercentage ?? 0;

        const newDisbDate = new Date();
        const newDueDate  = computeDueDate(newDisbDate, durationValue, durationUnit);

        const borrowerName = oldLoan.user
          ? `${oldLoan.user.firstName} ${oldLoan.user.lastName}`
          : oldLoan.external?.borrowerName || "Member";

        // mirrors approval route: user._id ?? initiatedBy._id ?? approvedBy
        const ledgerUser = oldLoan.user?._id ?? oldLoan.initiatedBy?._id ?? req.user._id;

        // ── Mark old loan as rolled_over ──────────────────────────────────────
        const balanceBeforeRollover = oldLoan.outstandingBalance || oldLoan.totalRepay;

        oldLoan.status        = "rolled_over";
        oldLoan.rolloverCount = (oldLoan.rolloverCount || 0) + 1;
        oldLoan.rolloverHistory.push({
          rolledOverAt:  new Date(),
          rolloverFee:   newInterestAmt,
          balanceBefore: balanceBeforeRollover,
          balanceAfter:  0,
          newDueDate,
          processedBy:   req.user._id,
        });

        if (payPenalty) {
          oldLoan.totalPenalty         = 0;
          oldLoan.penaltyHistory       = [];
          oldLoan.lastPenaltyAppliedAt = null;
        }

        await oldLoan.save();

        // ── Remove other pending/approved loans for this user ─────────────────
        // mirrors approval route exactly
        if (oldLoan.user) {
          const conflicting = await Loan.findOne({
            user:   oldLoan.user._id,
            _id:    { $ne: oldLoan._id },
            status: { $in: ["pending", "approved"] }
          });
          if (conflicting) await Loan.deleteOne({ _id: conflicting._id });
        }

        // ── Create new loan ───────────────────────────────────────────────────
        const newLoan = await Loan.create({
          user:               oldLoan.user?._id || oldLoan.user,
          initiatedBy:        oldLoan.initiatedBy?._id || oldLoan.initiatedBy || req.user._id,
          amount:             newBase,
          interestAmount:     newInterestAmt,
          interestRate:       newInterestRate,
          totalRepay:         newTotalRepay,
          outstandingBalance: newTotalRepay,
          paidAmount:         0,
          duration:           oldLoan.duration?._id || oldLoan.duration,
          dueDate:            newDueDate,
          disbursementDate:   newDisbDate,
          disbursementMethod: oldLoan.disbursementMethod || "bank",
          penaltyPercentage:  penaltyPct,
          rolloverPercentage: rolloverPct,
          totalPenalty:       0,
          penaltyHistory:     [],
          rolloverHistory:    [],
          rolloverCount:      0,
          guarantors: oldLoan.guarantors.map(g => ({
            guarantor:   g.guarantor?._id || g.guarantor,
            status:      "accepted",
            respondedAt: new Date(),
          })),
          status:     "approved",
          approvedAt: new Date(),
          updatedAt:  new Date(),
        });

        // Link old → new
        await Loan.updateOne(
          { _id: oldLoan._id },
          { $set: { rolledIntoLoan: newLoan._id } }
        );

        // Store new loan ID on payment
        await Payment.updateOne(
          { _id: payment._id },
          { $set: { "meta.newLoanId": newLoan._id } }
        );

        // Update linked transaction to successful
        await Transaction.findOneAndUpdate(
          { reference: payment.reference },
          { status: "successful" }
        );

        // ── Loan Ledger — mirrors approval route exactly ───────────────────────
        const ledgerEntry = await LoanLedger.create({
          loan:             newLoan._id,
          processedBy:      req.user._id,
          transactionType:  "disbursement",
          amount:           newBase,
          balanceBefore:    0,
          balanceAfter:     newTotalRepay,
          paymentMethod:    (oldLoan.disbursementMethod || "bank").toLowerCase(),
          member:           oldLoan.user?._id,
          externalBorrower: oldLoan.user ? undefined : oldLoan.external,
          notes:            `Rolled-over loan disbursed to ${borrowerName} on ${newDisbDate.toISOString()} (original loan: ${oldLoan._id})`
        });

        // ── Company Ledger: new loan disbursement out ─────────────────────────
        await CompanyLedger.create({
          type:        "loan_disbursement",
          direction:   "out",
          amount:      newBase,
          relatedUser: ledgerUser,
          relatedLoan: newLoan._id,
          description: `Rolled-over loan disbursed to ${borrowerName} via ${oldLoan.disbursementMethod || "bank"}`,
          recordedBy:  req.user._id,
          meta: {
            disbursementMethod:  oldLoan.disbursementMethod || "bank",
            disbursementDate:    newDisbDate,
            dueDate:             newDueDate,
            interestRate:        newInterestRate,
            totalRepay:          newTotalRepay,
            penaltyPercentage:   penaltyPct,
            rolloverPercentage:  rolloverPct,
            originalLoanId:      oldLoan._id,
            reference:           payment.reference,
            loanLedgerId:        ledgerEntry._id,
          },
        });

        // ── Company Ledger: interest income ───────────────────────────────────
        await CompanyLedger.create({
          type:        "interest_income",
          direction:   "in",
          amount:      interestPaid,
          relatedUser: ledgerUser,
          relatedLoan: oldLoan._id,
          description: `Rollover interest payment from ${borrowerName} (${payment.reference})`,
          recordedBy:  req.user._id,
          meta: { reference: payment.reference, notes: notes || "Rollover approved by admin" },
        });

        // ── Company Ledger: penalty income (if penalty was paid) ──────────────
        if (penaltyPaid > 0) {
          await ExtraCharge.create({
            member:      ledgerUser,
            chargeType:  "penalty",
            description: "Penalty cleared via rollover",
            amount:      penaltyPaid,
            relatedLoan: oldLoan._id,
            chargedBy:   req.user._id,
            status:      "paid",
            paidAt:      new Date(),
          });

          await CompanyLedger.create({
            type:        "penalty_income",
            direction:   "in",
            amount:      penaltyPaid,
            relatedUser: ledgerUser,
            relatedLoan: oldLoan._id,
            description: `Penalty cleared via rollover by ${borrowerName} (${payment.reference})`,
            recordedBy:  req.user._id,
            meta: { reference: payment.reference },
          });
        }

        // ── Borrower transaction — mirrors approval route ─────────────────────
        if (oldLoan.user) {
          await Transaction.create({
            user:        oldLoan.user._id,
            type:        "loan_payment",
            amount:      newBase,
            status:      "successful",
            method:      oldLoan.disbursementMethod || "bank",
            description: `Loan rolled over and new loan disbursed (original loan: ${oldLoan._id})`
          });
        }

        // ── Admin action log ──────────────────────────────────────────────────
        // placed here before ROI to mirror approval route ordering
        await AdminActionLog.create({
          admin:       req.user._id,
          adminRole:   req.user.role?.name || "admin",
          actionType:  "loan_approve",
          targetUser:  ledgerUser,
          targetModel: "Loan",
          targetId:    newLoan._id,
          description: `Approved loan rollover for ${borrowerName} — new loan ₦${newTotalRepay.toLocaleString()} at ${newInterestRate}% (ref: ${payment.reference})`,
          ipAddress:   req.ip,
          userAgent:   req.headers["user-agent"],
          status:      "success",
          meta: {
            loanId:            newLoan._id,
            originalLoanId:    oldLoan._id,
            amount:            newBase,
            totalRepay:        newTotalRepay,
            interestRate:      newInterestRate,
            disbursementMethod: oldLoan.disbursementMethod || "bank",
            disbursementDate:  newDisbDate,
            dueDate:           newDueDate,
            penaltyCleared:    penaltyPaid,
            reference:         payment.reference,
          }
        });

        // ═════════════════════════════════════════════════════════════════════
        // ROI DISTRIBUTION — exact mirror of /api/loans/approve
        // ═════════════════════════════════════════════════════════════════════
        const settings           = await Settings.getSettings();
        const roiOperatingCharge = Number(settings.otherFees?.roiOperatingCharge || 10);
        const now                = new Date();
        const currentMonth       = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

        // exact same formula as approval route
        const interestForLoan          = newLoan.interestAmount ?? (newLoan.amount * (newLoan.interestRate / 100) * durationValue);
        const companyChargeForThisLoan = interestForLoan * (roiOperatingCharge / 100);
        const netInterestForThisLoan   = interestForLoan - companyChargeForThisLoan;

        console.log("[ROI] newLoan.interestAmount:", newLoan.interestAmount);
        console.log("[ROI] interestForLoan:", interestForLoan);
        console.log("[ROI] companyChargeForThisLoan:", companyChargeForThisLoan);
        console.log("[ROI] netInterestForThisLoan:", netInterestForThisLoan);
        console.log("[ROI] currentMonth:", currentMonth);

        let companyRoi = await CompanyROI.findOne({ month: currentMonth });

        if (!companyRoi) {
          companyRoi = await CompanyROI.create({
            month:                  currentMonth,
            totalInterestCollected: interestForLoan,
            companyCharge:          companyChargeForThisLoan,
            netInterestForRoi:      netInterestForThisLoan,
            totalRoiDistributed:    0,
            status:                 "open",
            loanRoiHistory: [{
              loan:                 newLoan._id,
              interestForLoan,
              companyChargeForLoan: companyChargeForThisLoan,
              netInterestForLoan:   netInterestForThisLoan
            }]
          });
          console.log("[ROI] created new CompanyROI for month:", currentMonth);
        } else {
          companyRoi.totalInterestCollected += interestForLoan;
          companyRoi.companyCharge          += companyChargeForThisLoan;
          companyRoi.netInterestForRoi      += netInterestForThisLoan;
          companyRoi.loanRoiHistory.push({
            loan:                 newLoan._id,
            interestForLoan,
            companyChargeForLoan: companyChargeForThisLoan,
            netInterestForLoan:   netInterestForThisLoan
          });
          console.log("[ROI] updated existing CompanyROI for month:", currentMonth);
        }

        // ── Regular member accounts ───────────────────────────────────────────
        const memberAccounts = await Account.find({ ownerType: "User" })
          .populate({ path: "ownerId", model: "User", select: "_id firstName lastName" });

        console.log("[ROI] memberAccounts found:", memberAccounts.length);
        memberAccounts.forEach(acc => {
          console.log(
            `  [MEMBER ACC] _id=${acc._id} ownerType=${acc.ownerType}`,
            `ownerId=${acc.ownerId?._id} balance=${acc.balance}`
          );
        });

        // ── Active kiddies accounts ───────────────────────────────────────────
        const activeKiddies = await KiddiesAccount.find({ status: "active" })
          .populate({ path: "parent", select: "_id firstName lastName" })
          .populate({ path: "account" });

        console.log("[ROI] activeKiddies found:", activeKiddies.length);
        activeKiddies.forEach(ka => {
          console.log(
            `  [KIDDIES] _id=${ka._id} parent=${ka.parent?._id}`,
            `account=${ka.account?._id} balance=${ka.account?.balance}`
          );
        });

        // ── Unified pool ──────────────────────────────────────────────────────
        const pool = [
          ...memberAccounts.map(acc => ({
            accountDoc:  acc,
            ownerUserId: acc.ownerId?._id,
            description: `ROI from loan ${newLoan._id} (${currentMonth})`
          })),
          ...activeKiddies
            .filter(ka => !!ka.account && !!ka.parent)
            .map(ka => ({
              accountDoc:  ka.account,
              ownerUserId: ka.parent._id,
              description: `ROI from loan ${newLoan._id} (${currentMonth}) — kiddies account (${ka.childFirstName} ${ka.childLastName})`
            }))
        ];

        console.log("[ROI] pool size:", pool.length);

        // ── Total savings across the whole pool ───────────────────────────────
        const totalCumulativeSavings = pool.reduce(
          (sum, entry) => sum + Number(entry.accountDoc?.balance || 0), 0
        );

        console.log("[ROI] totalCumulativeSavings:", totalCumulativeSavings);

        const safeMoney        = n => Math.round(n * 100) / 100;
        let   totalDistributed = 0;

        // ── Distribute proportionally and persist ─────────────────────────────
        for (const entry of pool) {
          const { accountDoc, ownerUserId, description } = entry;
          const balance = Number(accountDoc?.balance || 0);

          console.log(
            `[ROI ENTRY] _id=${accountDoc?._id} ownerType=${accountDoc?.ownerType}`,
            `ownerUserId=${ownerUserId} balance=${balance}`
          );

          if (balance <= 0 || totalCumulativeSavings <= 0 || !ownerUserId) {
            console.log(
              `  [SKIP] reason: balance=${balance}`,
              `totalCumulativeSavings=${totalCumulativeSavings}`,
              `ownerUserId=${ownerUserId}`
            );
            continue;
          }

          const roundedROI = safeMoney((balance / totalCumulativeSavings) * netInterestForThisLoan);
          console.log(`  [DISTRIBUTE] ₦${roundedROI} → userId=${ownerUserId}`);

          accountDoc.monthlyRoiHistory.push({ month: currentMonth, roi: roundedROI });
          accountDoc.accumulativeROI = safeMoney((accountDoc.accumulativeROI || 0) + roundedROI);
          accountDoc.lastRoiPayout   = new Date();
          await accountDoc.save();

          totalDistributed += roundedROI;

          await Transaction.create({
            user:        ownerUserId,
            type:        "roi",
            amount:      roundedROI,
            status:      "successful",
            method:      "System Distribution",
            description
          });
        }

        console.log("[ROI] totalDistributed:", totalDistributed);

        companyRoi.totalRoiDistributed += safeMoney(totalDistributed);
        await companyRoi.save();

        if (companyChargeForThisLoan > 0) {
          await CompanyLedger.create({
            type:        "external_income",
            direction:   "in",
            amount:      companyChargeForThisLoan,
            relatedUser: ledgerUser,
            relatedLoan: newLoan._id,
            description: `ROI operating charge (${roiOperatingCharge}%) on loan for ${borrowerName}`,
            recordedBy:  req.user._id
          });
        }

        return res.status(200).json({
          message:        `Loan for ${borrowerName} rolled over successfully.`,
          roiDistributed: totalDistributed,
          oldLoanId:      oldLoan._id,
          newLoanId:      newLoan._id,
          newBase,
          newInterestAmt,
          newTotalRepay,
          newInterestRate,
          newDueDate,
          ledger:         ledgerEntry,
          companyRoi,
        });
      }
      // ═══════════════════════════════════════════════════════════════════════
      // END ROLLOVER BRANCH — regular loan payment continues below
      // ═══════════════════════════════════════════════════════════════════════

      const amount = Number(payment.amount);
      let overpayment    = 0;
      let isExternalLoan = false;

      // ═══════════════════════════════════════════════════════════════════════
      // 3. LOAN LOOKUP — member first, then external
      // ═══════════════════════════════════════════════════════════════════════
      let loan = null;

      if (payment.user) {
        loan = await Loan.findOne({
          _id:    payment.loanId,
          user:   payment.user._id,
          status: { $in: ["approved", "overdue"] },
        });
      }

      if (!loan) {
        loan = await Loan.findOne({
          _id:      payment.loanId,
          external: { $exists: true },
          status:   { $in: ["approved", "overdue"] },
        });
        if (loan) isExternalLoan = true;
      }

      if (!loan) {
        return res.status(404).json({ message: "Loan not found or inactive" });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 4. PRINCIPAL / PENALTY SPLIT
      // ═══════════════════════════════════════════════════════════════════════
      const loanPortion    = Math.min(amount, loan.totalRepay);
      const penaltyPortion = parseFloat((amount - loanPortion).toFixed(2));

      // ═══════════════════════════════════════════════════════════════════════
      // 5. OVERPAYMENT DETECTION
      // ═══════════════════════════════════════════════════════════════════════
      overpayment = parseFloat((amount - loan.totalRepay).toFixed(2));

      const memberAccount = payment.user
        ? await Account.findOne({ ownerType: "User", ownerId: payment.user._id })
        : null;

      const hasOverpayment = overpayment > 0 && !isExternalLoan && !!memberAccount;

      // ═══════════════════════════════════════════════════════════════════════
      // 6. UPDATE LOAN BALANCES
      // ═══════════════════════════════════════════════════════════════════════
      loan.totalRepay = parseFloat((loan.totalRepay - loanPortion).toFixed(2));
      loan.outstandingBalance = parseFloat(
        Math.max((loan.outstandingBalance || 0) - loanPortion, 0).toFixed(2)
      );
      loan.paidAmount = parseFloat(((loan.paidAmount || 0) + loanPortion).toFixed(2));

      // ═══════════════════════════════════════════════════════════════════════
      // 7. TRANSACTION RECORD
      // ═══════════════════════════════════════════════════════════════════════
      const txDescription = isExternalLoan
        ? `External loan repayment approved (${payment.reference}) – ${loan.external.borrowerName}`
        : `Manual loan repayment approved (${payment.reference})`;

      await Transaction.create({
        user:        payment.user._id,
        type:        "loan_payment",
        amount:      loanPortion,
        description: txDescription,
        reference:   payment.reference,
        method:      "Manual",
        status:      "successful",
      });

      // ═══════════════════════════════════════════════════════════════════════
      // 8. COMPANY LEDGER — PRINCIPAL REPAYMENT
      // ═══════════════════════════════════════════════════════════════════════
      const existingLedger = await CompanyLedger.findOne({
        "meta.reference": payment.reference,
        type:             "loan_repayment",
      });

      if (!existingLedger) {
        await CompanyLedger.create({
          type:        "loan_repayment",
          direction:   "in",
          amount:      loanPortion,
          relatedUser: payment.user._id,
          relatedLoan: loan._id,
          description: isExternalLoan
            ? `External loan repayment – ${loan.external.borrowerName}`
            : `Member loan repayment (${payment.reference})`,
          recordedBy:  req.user._id,
          meta: {
            reference:  payment.reference,
            notes:      notes || "Approved by admin",
            isExternal: isExternalLoan,
          },
        });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 9. PENALTY INCOME LEDGER
      // ═══════════════════════════════════════════════════════════════════════
      const penaltyProfit = penaltyPortion > 0
        ? penaltyPortion
        : (loan.totalRepay === 0 ? (loan.totalPenalty || 0) : 0);

      if (penaltyProfit > 0 && loan.totalRepay === 0) {
        const existingPenaltyLedger = await CompanyLedger.findOne({
          "meta.reference": payment.reference,
          type:             "penalty_income",
        });

        if (!existingPenaltyLedger) {
          const extraCharge = await ExtraCharge.create({
            member:      payment.user._id,
            chargeType:  "penalty",
            description: "Overdue penalty settlement",
            amount:      penaltyProfit,
            relatedLoan: loan._id,
            chargedBy:   req.user._id,
            status:      "paid",
            paidAt:      new Date(),
          });

          await CompanyLedger.create({
            type:        "penalty_income",
            direction:   "in",
            amount:      penaltyProfit,
            relatedUser: payment.user._id,
            relatedLoan: loan._id,
            description: isExternalLoan
              ? `Penalty income – ${loan.external.borrowerName}`
              : "Penalty income from cleared loan",
            recordedBy:  req.user._id,
            meta: {
              reference:     payment.reference,
              extraChargeId: extraCharge._id,
            },
          });
        }
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 10. FULLY SETTLED
      // ═══════════════════════════════════════════════════════════════════════
      if (loan.totalRepay === 0) {
        loan.status = "paid";
        loan.paidAt = new Date();

        await Transaction.create({
          user:        payment.user._id,
          type:        "loan_repayment",
          amount:      0,
          description: isExternalLoan
            ? `External loan fully settled – ${loan.external.borrowerName}`
            : "Loan fully settled (manual payment)",
          method:      "system",
          status:      "successful",
        });
      }

      await loan.save();

      // ═══════════════════════════════════════════════════════════════════════
      // 11. OVERPAYMENT — CREDIT SURPLUS TO MEMBER'S SAVINGS ACCOUNT
      // ═══════════════════════════════════════════════════════════════════════
      if (hasOverpayment && memberAccount) {
        const balanceBefore = memberAccount.balance;

        memberAccount.balance = parseFloat(
          (memberAccount.balance + overpayment).toFixed(2)
        );
        await memberAccount.save();

        const balanceAfter = memberAccount.balance;

        await DepositReport.create({
          member:          payment.user._id,
          account:         memberAccount._id,
          amount:          overpayment,
          type:            "bank_transfer",
          reference:       payment.reference,
          description:     `Loan overpayment refund – surplus from loan repayment (${payment.reference})`,
          status:          "approved",
          balanceBefore,
          balanceAfter,
          processedBy:     req.user._id,
          processedByRole: req.user.role?.name || "admin",
          processedAt:     new Date(),
          notes:           `Overpayment of ₦${overpayment.toLocaleString()} credited after loan settlement`,
        });

        await Transaction.create({
          user:        payment.user._id,
          type:        "deposit",
          amount:      overpayment,
          description: `Loan overpayment refund (${payment.reference})`,
          reference:   `${payment.reference}-overpay`,
          method:      "system",
          status:      "successful",
        });

        await CompanyLedger.create({
          type:        "overpayment_refund",
          direction:   "out",
          amount:      overpayment,
          relatedUser: payment.user._id,
          relatedLoan: loan._id,
          description: `Overpayment surplus credited to member savings (${payment.reference})`,
          recordedBy:  req.user._id,
          meta: {
            reference: payment.reference,
            notes:     `Paid ₦${amount.toLocaleString()}, loan required ₦${loanPortion.toLocaleString()}`,
          },
        });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 12. ADMIN ACTION LOG
      // ═══════════════════════════════════════════════════════════════════════
      await AdminActionLog.create({
        admin:       req.user._id,
        adminRole:   req.user.role?.name || "admin",
        actionType:  "deposit_approve",
        targetUser:  payment.user?._id || null,
        targetModel: "Payment",
        targetId:    payment._id,
        description: `Approved loan payment ${payment.reference}`,
        ipAddress:   req.ip,
        userAgent:   req.headers["user-agent"],
        status:      "success",
      });

      return res.json({
        success: true,
        message: "Loan payment approved and applied",
        newBalance: payment.user?.account?.balance || 0,
        ...(overpayment > 0 && !isExternalLoan && {
          overpaymentCredited: overpayment,
        }),
      });

    } catch (error) {
      console.error("Approve loan payment error:", error);
      res.status(500).json({ message: "Internal server error", error: error.message });
    }
  }
);


// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/loans/:id/reject-payment
// Reject a pending loan payment OR a pending rollover request.
// Rejecting never mutates the Loan document — it just declines the request.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/admin/loans/:id/reject-payment",
  ensureAdmin("process_deposits"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      // ═══════════════════════════════════════════════════════════════════════
      // 1. ATOMIC REJECTION — only touch payments that haven't been processed
      // ═══════════════════════════════════════════════════════════════════════
      const payment = await Payment.findOneAndUpdate(
        {
          _id: id,
          status: { $nin: ["success", "paid", "rejected", "failed"] },
        },
        {
          $set: {
            status: "rejected",
            "paystackResponse.adminNote": reason || "Rejected by admin",
            "paystackResponse.rejectedAt": new Date(),
          },
        },
        { new: true }
      ).populate({ path: "user", populate: { path: "account" } });

      if (!payment) {
        return res.status(400).json({ message: "Payment already processed or not found" });
      }

      if (!payment.loanId) {
        return res.status(400).json({ message: "This payment is not a loan payment." });
      }

      const isRollover =
        payment.type === "rollover_request" || payment.paymentType === "rollover_request";

      // ═══════════════════════════════════════════════════════════════════════
      // 2. LINKED TRANSACTION — mark it declined so it doesn't sit as "pending"
      // ═══════════════════════════════════════════════════════════════════════
      await Transaction.findOneAndUpdate(
        { reference: payment.reference },
        {
          status: "declined",
          description: isRollover
            ? `Rollover request rejected by admin: ${reason || "No reason provided"}`
            : `Loan payment rejected by admin: ${reason || "No reason provided"}`,
        }
      );

      // ═══════════════════════════════════════════════════════════════════════
      // 3. NOTE: no Loan document is touched here.
      //    - Regular repayment reject → loan balance stays exactly as it was.
      //    - Rollover reject → the original loan stays "approved"/"overdue",
      //      no new loan is created, oldLoan.status is never flipped to
      //      "rolled_over". This is the mirror-opposite of the rollover
      //      branch in /approve-payment, which is the only place that logic
      //      lives — so rejecting here is simply "do nothing to the loan".
      // ═══════════════════════════════════════════════════════════════════════

      // ═══════════════════════════════════════════════════════════════════════
      // 4. ADMIN ACTION LOG
      // ═══════════════════════════════════════════════════════════════════════
      await AdminActionLog.create({
        admin:       req.user._id,
        adminRole:   req.user.role?.name || "admin",
        actionType:  isRollover ? "loan_rollover_reject" : "deposit_reject",
        targetUser:  payment.user?._id || null,
        targetModel: "Payment",
        targetId:    payment._id,
        description: isRollover
          ? `Rejected loan rollover request ${payment.reference}: ${reason || "No reason provided"}`
          : `Rejected loan payment ${payment.reference}: ${reason || "No reason provided"}`,
        ipAddress:  req.ip,
        userAgent:  req.headers["user-agent"],
        status:     "success",
      });

      return res.json({
        success: true,
        message: isRollover
          ? "Rollover request rejected. The original loan is unchanged."
          : "Loan payment rejected. Loan balance is unchanged.",
      });

    } catch (error) {
      console.error("Reject loan payment error:", error);
      res.status(500).json({ message: "Internal server error", error: error.message });
    }
  }
);




// POST /api/loans/:loanId/waive-penalty
router.post("/api/loans/:loanId/waive-penalty", ensureAdmin("approve_loans"), async (req, res) => {
  try {
    const { loanId } = req.params;
    const { reason } = req.body;

    const waivedBy = req.user?._id;
    if (!waivedBy) return res.status(401).json({ success: false, message: "Unauthorized." });

    const loan = await Loan.findById(loanId);
    if (!loan) {
      return res.status(404).json({ success: false, message: "Loan not found." });
    }

    if (!loan.totalPenalty || loan.totalPenalty <= 0) {
      return res.status(400).json({ success: false, message: "This loan has no penalty to waive." });
    }

    const waivedAmount  = loan.totalPenalty;
    const balanceBefore = loan.outstandingBalance || 0;
    const balanceAfter  = Math.max(0, balanceBefore - waivedAmount);

    const adminName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'Admin';

    loan.outstandingBalance  = balanceAfter;
    loan.totalPenalty        = 0;
    loan.penaltyWaived       = true;
    loan.penaltyWaivedAmount = waivedAmount;
    loan.penaltyWaivedBy     = waivedBy;
    loan.penaltyWaivedByName = adminName;
    loan.penaltyWaivedAt     = new Date();

    loan.penaltyWaiverHistory.push({
      waivedAt: new Date(),
      waivedAmount,
      waivedBy,
      waivedByName: adminName,
      balanceBefore,
      balanceAfter,
      reason: reason || "Waived by admin"
    });

    loan.updatedAt = new Date();
    await loan.save();

    // ── Admin action log — matches the pattern used across approve/reject/rollover ──
    await AdminActionLog.create({
      admin:       waivedBy,
      adminRole:   req.user.role?.name || "admin",
      actionType:  "loan_penalty_waive",
      targetUser:  loan.user || null,
      targetModel: "Loan",
      targetId:    loan._id,
      description: `Waived penalty of ₦${waivedAmount.toLocaleString()} on loan ${loan._id}`,
      ipAddress:   req.ip,
      userAgent:   req.headers["user-agent"],
      status:      "success",
      meta: {
        loanId: loan._id,
        waivedAmount,
        balanceBefore,
        balanceAfter,
        reason: reason || "Waived by admin"
      }
    });

    return res.json({
      success: true,
      message: `Penalty of ₦${waivedAmount.toLocaleString()} waived successfully.`,
      loan: {
        _id:                 loan._id,
        totalPenalty:        loan.totalPenalty,
        outstandingBalance:  loan.outstandingBalance,
        penaltyWaived:       loan.penaltyWaived,
        penaltyWaivedAmount: loan.penaltyWaivedAmount,
        penaltyWaivedByName: loan.penaltyWaivedByName,
        penaltyWaivedAt:     loan.penaltyWaivedAt
      }
    });
  } catch (err) {
    console.error("Waive penalty error:", err);
    return res.status(500).json({ success: false, message: "Server error while waiving penalty." });
  }
});

module.exports = router;