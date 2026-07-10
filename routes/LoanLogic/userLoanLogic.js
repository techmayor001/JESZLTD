const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const Loan = require("../../models/Loan");
const LoanSettings = require("../../models/LoanSettings");
const User = require("../../models/User");
const Settings = require("../../models/Settings");
const Payment = require("../../models/Payment");
const Transaction = require("../../models/Transaction");
const CompanyLedger = require("../../models/CompanyLedger");
const CompanyAccount = require("../../models/companyRoiSchema");



// LOAN ROUTE 
router.get("/cds-cooperative/loan", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    const user = await User.findById(req.user._id)
      .populate({
        path: "account",
        populate: { path: "accountType", model: "MemberType" }
      })
      .populate("guarantorRequests");

    if (!user) return res.redirect("/login");

    // Merge role from req.user (already populated by Passport)
    user.role = req.user.role;

    const users = await User.find({});

    const loanSettings = await LoanSettings.find({ status: "active" })
      .sort({ loanName: 1 })
      .lean();

    const activeLoan = await Loan.findOne({
      user: user._id,
      status: { $in: ["pending", "approved", "overdue"] }
    })
      .populate({ path: "duration", model: "LoanSettings" })
      .populate({
        path: "guarantors.guarantor",
        model: "User",
        select: "firstName lastName membershipID"
      })
      .lean();

    let dueDate      = null;
    let daysUntilDue = null;

    if (activeLoan) {
      if (activeLoan.dueDate) {
        dueDate = new Date(activeLoan.dueDate);
        const msDiff = dueDate - new Date();
        daysUntilDue = Math.max(0, Math.ceil(msDiff / (1000 * 60 * 60 * 24)));
      } else if (activeLoan.duration) {
        const createdAt   = new Date(activeLoan.createdAt);
        const monthsToAdd = activeLoan.duration.duration;
        dueDate = new Date(createdAt);
        dueDate.setMonth(dueDate.getMonth() + monthsToAdd);
        const msDiff = dueDate - new Date();
        daysUntilDue = Math.max(0, Math.ceil(msDiff / (1000 * 60 * 60 * 24)));
      }
    }

    const interestRate = user.account?.accountType?.interestRate || 0;

    const today = new Date();
    const monthsSinceJoin = Math.floor(
      (today - user.createdAt) / (1000 * 60 * 60 * 24 * 30)
    );

    const settings       = await Settings.getSettings();
    const companyAccount = settings.companyAccount || {};

    const pendingGuarantorCount = user.guarantorRequests
      ? user.guarantorRequests.filter(r => r.status === "pending").length
      : 0;

    let rolloverPending = false;
    if (activeLoan) {
      const pendingRollover = await Payment.findOne({
        loanId: activeLoan._id,
        type:   "rollover_request",
        status: { $in: ["pending", "approved", "success"] }
      }).lean();
      rolloverPending = !!pendingRollover;
    }

    res.render("dashboard/user/loan", {
      user,
      users,
      loan: activeLoan,
      interestRate,
      monthsSinceJoin,
      loanSettings,
      dueDate,
      daysUntilDue,
      companyAccount,
      pendingGuarantorCount,
      rolloverPending,
    });

  } catch (err) {
    console.error("Loan page error:", err);
    res.redirect("/cds-cooperative/dashboard");
  }
});
// LOAN APPLICATION ROUTE
router.post("/club-de-star-cooperative/apply-loan", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    let { amount, duration, guarantor1, guarantor2, agreeTerms } = req.body;
    amount = Number(amount);

    if (!agreeTerms) {
      return res.status(400).json({ message: "You must agree to the loan terms." });
    }
    if (guarantor1 === guarantor2) {
      return res.status(400).json({ message: "You cannot select the same guarantor twice." });
    }
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ message: "Invalid loan amount." });
    }

    const user = await User.findById(req.user._id)
      .populate({
        path: "account",
        populate: { path: "accountType" } // MemberType
      });

    if (!user?.account?.accountType) {
      return res.status(400).json({ message: "User account type not set." });
    }

    // Prevent multiple active loans
    const existingLoan = await Loan.findOne({
      user: user._id,
      status: { $in: ["pending", "approved"] }
    });
    if (existingLoan) {
      return res.status(400).json({ message: "You already have an active or pending loan." });
    }

    // Get loan duration settings
    const loanSetting = await LoanSettings.findById(duration);
    if (!loanSetting) return res.status(400).json({ message: "Invalid loan duration selected." });

    const durationValue = Number(loanSetting.duration);
    const durationUnit = loanSetting.durationUnit || "months";
    if (isNaN(durationValue) || durationValue <= 0) {
      return res.status(400).json({ message: "Invalid loan duration value." });
    }

    // ── Interest Calculation ─────────────────────────────────────────
    const interestRate = Number(user.account.accountType.interestRate); // %
    const interestAmount = amount * (interestRate / 100) * durationValue;
    const totalRepay = Math.round(amount + interestAmount);

    // Create loan with interest stored and outstandingBalance initialized
    const loan = await Loan.create({
      user: user._id,
      amount,
      interestRate,
      interestAmount,
      totalRepay,
      outstandingBalance: totalRepay,
      duration,
      status: "pending",
      guarantors: [
        { guarantor: guarantor1 },
        { guarantor: guarantor2 }
      ]
    });

    // Create guarantor requests
    await Promise.all([guarantor1, guarantor2].map(async gid => {
      const gUser = await User.findById(gid);
      if (!gUser) return;
      gUser.guarantorRequests.push({
        borrower: user._id,
        loan: loan._id,
        amount
      });
      gUser.guarantorRequestStats.totalReceived += 1;
      await gUser.save();
    }));

    return res.status(200).json({
      message: "Loan application submitted successfully.",
      amount,
      interestAmount,
      interestRate,
      totalRepay,
      durationValue,
      durationUnit
    });

  } catch (error) {
    console.error("Loan application error:", error);
    return res.status(500).json({
      message: "An error occurred while submitting the loan application."
    });
  }
});

// LOAN ROLLOVER ROUTES
// ═════════════════════════════════════════════════════════════════════════════
// GET /club-de-star-cooperative/rollover-status
router.get("/club-de-star-cooperative/rollover-status", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });

  try {
    const loan = await Loan.findOne({
      user:   req.user._id,
      status: { $in: ["approved", "overdue"] }
    }).populate("duration");

    if (!loan) return res.status(404).json({ message: "No active loan found." });

    const user = await User.findById(req.user._id).populate({
      path:     "account",
      populate: { path: "accountType", model: "MemberType" }
    });

    const memberType     = user?.account?.accountType;
    const memberInterest = memberType?.interestRate || 0; // e.g. 5%

    const companyAccount = await CompanyAccount.findOne({ status: "active" });

    const existingRollover = await Payment.findOne({
      loanId: loan._id,
      type:   "rollover_request",
      status: { $in: ["pending", "approved", "success"] }
    });

    const rolloverPct     = loan.duration?.rolloverPercentage ?? loan.rolloverPercentage ?? 0; // e.g. 1%
    const newInterestRate = parseFloat((memberInterest + rolloverPct).toFixed(4));              // e.g. 6%

    const principal   = loan.amount;
    const interest    = loan.interestAmount
                        || Math.round(loan.amount * (memberInterest / 100));
    const penalty     = loan.totalPenalty || 0;
    const outstanding = loan.outstandingBalance || loan.totalRepay;

    // ⭐ New total = principal + (principal × newInterestRate%)
    // e.g. 1000 + (1000 × 6%) = 1000 + 60 = 1060
    const newInterestAmount = parseFloat((principal * (newInterestRate / 100)).toFixed(2));
    const newTotalRepay     = parseFloat((principal + newInterestAmount).toFixed(2));

    return res.json({
      loanId:             loan._id,
      rolloverPending:    !!existingRollover,
      principalAmount:    principal,
      interestOwed:       interest,
      totalPenalty:       penalty,
      outstandingBalance: outstanding,
      memberInterestRate: memberInterest,  // 5%
      rolloverPct,                         // 1%
      newInterestRate,                     // 6%
      newInterestAmount,                   // ₦60 — interest at new rate
      newTotalRepay,                       // ₦1,060
      loanName:           loan.duration?.loanName || "Current Loan",
      companyAccount,
    });

  } catch (err) {
    console.error("Rollover status error:", err);
    return res.status(500).json({ message: "Server error." });
  }
});
// ═════════════════════════════════════════════════════════════════════════════
// POST /club-de-star-cooperative/rollover-interest-payment
router.post("/club-de-star-cooperative/rollover-request", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const {
      loanId, interestAmount, penaltyAmount,
      payerName, payPenalty, paymentMethod, paystackRef
    } = req.body;

    if (!loanId || !interestAmount) {
      return res.status(400).json({ message: "Loan ID and interest amount are required." });
    }

    const loan = await Loan.findOne({
      _id:    loanId,
      user:   req.user._id,
      status: { $in: ["approved", "overdue"] }
    }).populate("duration");

    if (!loan) {
      return res.status(404).json({ message: "Loan not found or not active." });
    }

    // Block if a rollover request already exists
    const existingRollover = await Payment.findOne({
      loanId: loan._id,
      type:   "rollover_request",
      status: { $in: ["pending", "approved", "success"] }
    });

    if (existingRollover) {
      return res.status(400).json({
        message: existingRollover.status === "pending"
          ? "A rollover request is already pending admin approval."
          : "This loan has already been rolled over."
      });
    }

    // Fetch member type for rate calculation
    const user = await User.findById(req.user._id).populate({
      path:     "account",
      populate: { path: "accountType", model: "MemberType" }
    });

    const memberType      = user?.account?.accountType;
    const memberInterest  = memberType?.interestRate || 0;
    const rolloverPct     = loan.duration?.rolloverPercentage ?? loan.rolloverPercentage ?? 0;
    const newInterestRate = parseFloat((memberInterest + rolloverPct).toFixed(4));

    const parsedInterest = Math.round(Number(interestAmount));
    const parsedPenalty  = payPenalty ? Math.round(Number(penaltyAmount || 0)) : 0;
    const totalPaid      = parsedInterest + parsedPenalty;

    if (isNaN(parsedInterest) || parsedInterest <= 0) {
      return res.status(400).json({ message: "Invalid interest amount." });
    }

    const principal = loan.amount;

    // New base: penalty cleared if paid now, otherwise carries forward
    const newBase = payPenalty
      ? principal
      : parseFloat((principal + (loan.totalPenalty || 0)).toFixed(2));

    // New total = newBase + (newBase × newInterestRate%)
    const newInterestAmt = parseFloat((newBase * (newInterestRate / 100)).toFixed(2));
    const newTotalRepay  = parseFloat((newBase + newInterestAmt).toFixed(2));

    const reference = paymentMethod === "paystack" && paystackRef
      ? paystackRef
      : `ROLLOVER-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    await Payment.create({
      user:        req.user._id,
      email:       req.user.email,
      loan:        loan._id,
      loanId:      loan._id,
      amount:      totalPaid,
      reference,
      type:        "rollover_request",       // ← primary field
      paymentType: "rollover_request",       // ← backwards compat
      payeeName:   payerName?.trim() || null,
      status:      paymentMethod === "paystack" ? "success" : "pending",
      meta: {
        interestPaid:         parsedInterest,
        penaltyPaid:          parsedPenalty,
        payPenalty:           !!payPenalty,
        paymentMethod:        paymentMethod || "manual",
        newInterestRate,
        newTotalRepay,
        newBase,
        newInterestAmt,
        principalAtRequest:   principal,
        outstandingAtRequest: loan.outstandingBalance || loan.totalRepay,
      }
    });

    await Transaction.create({
      user:        req.user._id,
      type:        "loan_payment",
      amount:      totalPaid,
      description: `Loan rollover payment — interest: ₦${parsedInterest.toLocaleString()}` +
                   `${parsedPenalty > 0 ? `, penalty: ₦${parsedPenalty.toLocaleString()}` : ""}` +
                   ` (${paymentMethod === "paystack" ? "Paystack" : "Pending admin approval"})`,
      reference,
      method:      paymentMethod === "paystack" ? "Paystack" : "Manual",
      status:      paymentMethod === "paystack" ? "successful" : "pending"
    });

    return res.status(200).json({
      status:  true,
      message: paymentMethod === "paystack"
        ? "Rollover payment confirmed. Admin will complete your rollover shortly."
        : "Rollover request submitted. Admin will complete your rollover once payment is confirmed.",
      reference,
      summary: {
        interestPaid:    parsedInterest,
        penaltyPaid:     parsedPenalty,
        totalPaid,
        newInterestAmt,
        newTotalRepay,
        newBase,
        newInterestRate,
      }
    });

  } catch (err) {
    console.error("Rollover request error:", err);
    return res.status(500).json({ message: "Server error." });
  }
});


// ═════════════════════════════════════════════════════════════════════════════
// POST /club-de-star-cooperative/rollover-loan
// CHANGED: duration is no longer taken from req.body — always reuses old loan's type
router.post("/club-de-star-cooperative/rollover-loan", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    // ── 1. Load user ──────────────────────────────────────────────────────────
    const user = await User.findById(req.user._id).populate({
      path:     "account",
      populate: { path: "accountType" }
    });
    if (!user) return res.status(404).json({ message: "User not found." });

    // ── 2. Load active loan ───────────────────────────────────────────────────
    const oldLoan = await Loan.findOne({
      user:   user._id,
      status: { $in: ["approved", "overdue"] }
    }).populate("duration");

    if (!oldLoan) {
      return res.status(400).json({ message: "No active loan eligible for rollover." });
    }

    // ── 3. Guard: interest must be paid before rollover ───────────────────────
    const interestPayment = await Payment.findOne({
      loanId: oldLoan._id,
      type:   "interest",
      status: { $in: ["success", "paid", "approved"] }
    });

    if (!interestPayment) {
      const durationMonths = oldLoan.duration?.duration ?? oldLoan.externalDuration ?? 1;
      const interestOwed   = parseFloat(
        (oldLoan.amount * (oldLoan.interestRate / 100) * durationMonths).toFixed(2)
      );
      const settings = await Settings.getSettings();

      return res.status(402).json({
        code:           "INTEREST_UNPAID",
        message:        "Interest must be paid before rollover.",
        interestOwed,
        loanId:         oldLoan._id,
        companyAccount: settings.companyAccount
      });
    }

    // ── 4. CHANGED: Reuse old loan's duration — user cannot switch loan type ──
    const loanSetting = await LoanSettings.findById(
      oldLoan.duration?._id || oldLoan.duration
    );
    if (!loanSetting) {
      return res.status(400).json({ message: "Original loan duration setting not found." });
    }

    // ── 5. Compute rollover fee and new totalRepay ────────────────────────────
    const outstandingBalance = parseFloat(
      (oldLoan.outstandingBalance || oldLoan.totalRepay).toFixed(2)
    );
    const rolloverPct   = oldLoan.duration?.rolloverPercentage ?? oldLoan.rolloverPercentage ?? 0;
    const rolloverFee   = parseFloat((outstandingBalance * (rolloverPct / 100)).toFixed(2));
    const newTotalRepay = parseFloat((outstandingBalance + rolloverFee).toFixed(2));
    const newInterestRate = oldLoan.interestRate;

    // ── 6. Create new rollover loan ───────────────────────────────────────────
    const newGuarantors = oldLoan.guarantors.map(g => ({
      guarantor:   g.guarantor,
      status:      "accepted",
      respondedAt: new Date()
    }));

    const newLoan = await Loan.create({
      user:               user._id,
      amount:             outstandingBalance,
      totalRepay:         newTotalRepay,
      outstandingBalance: newTotalRepay,
      interestRate:       newInterestRate,
      duration:           loanSetting._id,
      penaltyPercentage:  oldLoan.penaltyPercentage,
      rolloverPercentage: rolloverPct,
      rolloverCount:      (oldLoan.rolloverCount || 0) + 1,
      totalPenalty:       0,
      guarantors:         newGuarantors,
      status:             "pending",
      penaltyHistory:     oldLoan.penaltyHistory || [],
      rolloverHistory: [
        ...(oldLoan.rolloverHistory || []),
        {
          rolledOverAt:  new Date(),
          rolloverFee,
          balanceBefore: outstandingBalance,
          balanceAfter:  newTotalRepay,
          processedBy:   user._id
        }
      ]
    });

    // ── 7. Close old loan ─────────────────────────────────────────────────────
    oldLoan.status         = "rolled_over";
    oldLoan.paidAt         = new Date();
    oldLoan.updatedAt      = new Date();
    oldLoan.rolledIntoLoan = newLoan._id;
    await oldLoan.save();

    // ── 8. Company Ledger — rollover_income (FEE ONLY) ────────────────────────
    if (rolloverFee > 0) {
      await CompanyLedger.create({
        type:        "rollover_income",
        direction:   "in",
        amount:      rolloverFee,
        relatedUser: user._id,
        relatedLoan: newLoan._id,
        description: `Rollover fee (${rolloverPct}%) – ${user.firstName} ${user.lastName}`,
        recordedBy:  user._id,
        meta: {
          oldLoanId:          oldLoan._id,
          newLoanId:          newLoan._id,
          outstandingCarried: outstandingBalance,
          rolloverPct,
          newTotalRepay
        }
      });
    }

    // ── 9. Transaction record ─────────────────────────────────────────────────
    await Transaction.create({
      user:        user._id,
      type:        "loan_payment",
      amount:      outstandingBalance,
      status:      "successful",
      method:      "Rollover",
      description: `Loan rolled over — ₦${outstandingBalance.toLocaleString()} carried + ₦${rolloverFee.toLocaleString()} rollover fee`
    });

    return res.status(200).json({
      message:      "Rollover request submitted. Awaiting admin approval.",
      newLoanId:    newLoan._id,
      oldLoanId:    oldLoan._id,
      rolloverFee,
      newTotalRepay
    });

  } catch (err) {
    console.error("Rollover error:", err);
    return res.status(500).json({ message: "An error occurred while processing rollover." });
  }
});

router.get("/api/user/loans/active", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    const loans = await Loan.find({
      user: req.user._id,
      status: { $in: ["approved", "overdue"] }   // include overdue loans too
    }).select(
      "_id " +
      "amount " +            // original borrowed amount
      "totalRepay " +        // principal + agreed interest (no penalties)
      "outstandingBalance " + // live balance = totalRepay + accumulated penalties
      "totalPenalty " +      // total penalty charged so far
      "penaltyPercentage " + // daily penalty rate (e.g. 0.5 = 0.5 %/day)
      "penaltyHistory " +    // array of penalty entries (optional, for audit)
      "dueDate " +           // repayment due date
      "status"               // "approved" | "overdue" — used by frontend
    );

    res.json(loans);
  } catch (err) {
    console.error("Error fetching active loans:", err);
    res.status(500).json({ message: "Failed to fetch loans" });
  }
});

// GUARANTOR REQUEST ROUTE 
router.get("/cds-cooperative/guarantorRequest", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    // Fetch user and populate guarantorRequests → include borrower info
    const user = await User.findById(req.user._id)
      .populate({
        path: "guarantorRequests.borrower",
        select: "firstName lastName email phone membershipID",
      })
      .exec();

    if (!user) return res.redirect("/login");

    // Separate requests by status if needed (optional)
    const pendingRequests = user.guarantorRequests.filter(r => r.status === "pending");
    const acceptedRequests = user.guarantorRequests.filter(r => r.status === "accepted");
    const declinedRequests = user.guarantorRequests.filter(r => r.status === "declined");

    // Send all relevant info to frontend
    res.render("dashboard/user/guarantorRequest", {
      user,
      pendingRequests,
      acceptedRequests,
      declinedRequests,
      stats: user.guarantorRequestStats || {
        totalReceived: 0,
        totalAccepted: 0,
        totalDeclined: 0,
        totalAmountApproved: 0,
      },
    });

  } catch (err) {
    console.error("Guarantor Request page error reads:", err);
    res.redirect("/club-de-star-cooperative/dashboard");
  }
});

// POST: Approve guarantor request
router.post('/club-de-star-cooperative/guarantorRequest/approve', async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect("/login");

    try {
        const { requestId } = req.body;
        if (!requestId) return res.status(400).send("Request ID required.");

        // Find the guarantor (the logged-in user)
        const guarantor = await User.findOne({ "guarantorRequests._id": requestId });
        if (!guarantor) return res.status(404).send("Request not found.");

        // Ensure the logged-in user is the guarantor
        if (!guarantor._id.equals(req.user._id)) {
            return res.status(403).send("You can only approve your own requests.");
        }

        // Locate the request
        const request = guarantor.guarantorRequests.id(requestId);

        // Update request status
        request.status = "accepted";
        request.respondedAt = new Date();

        // Update guarantor stats
        guarantor.guarantorRequestStats.totalAccepted += 1;
        guarantor.guarantorRequestStats.totalAmountApproved += request.amount;

        await guarantor.save();

        // ---- UPDATE LOAN GUARANTOR STATUS ----
        if (request.loan) {
            await Loan.updateOne(
                { _id: request.loan, "guarantors.guarantor": guarantor._id },
                {
                    $set: {
                        "guarantors.$.status": "accepted",
                        "guarantors.$.respondedAt": new Date()
                    }
                }
            );
        }

        return res.redirect("/cds-cooperative/guarantorRequest");
    } catch (err) {
        console.error(err);
        res.status(500).send("Server error.");
    }
});

// POST: Decline guarantor request
router.post('/club-de-star-cooperative/guarantorRequest/decline', async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect("/login");

    try {
        const { requestId } = req.body;
        if (!requestId) return res.status(400).send("Request ID required.");

        const guarantor = await User.findOne({ "guarantorRequests._id": requestId });
        if (!guarantor) return res.status(404).send("Request not found.");

        if (!guarantor._id.equals(req.user._id)) {
            return res.status(403).send("You can only decline your own requests.");
        }

        const request = guarantor.guarantorRequests.id(requestId);

        request.status = "declined";
        request.respondedAt = new Date();

        guarantor.guarantorRequestStats.totalDeclined += 1;

        await guarantor.save();

        // ---- UPDATE LOAN GUARANTOR STATUS ----
        if (request.loan) {
            await Loan.updateOne(
                { _id: request.loan, "guarantors.guarantor": guarantor._id },
                {
                    $set: {
                        "guarantors.$.status": "declined",
                        "guarantors.$.respondedAt": new Date()
                    }
                }
            );
        }

        return res.redirect("back");
    } catch (err) {
        console.error(err);
        res.status(500).send("Server error.");
    }
});

module.exports = router;