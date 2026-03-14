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



// LOAN ROUTE 
router.get("/cds-cooperative/loan", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    // Fetch logged-in user
    const user = await User.findById(req.user._id)
      .populate({
        path: "account",
        populate: { path: "accountType", model: "MemberType" }
      })
      .populate("guarantorRequests");

    if (!user) return res.redirect("/login");

    // Fetch all users
    const users = await User.find({});

    // Fetch active loan settings
    const loanSettings = await LoanSettings.find({ status: "active" })
      .sort({ loanName: 1 })
      .lean();

    // Fetch user's current loan
    const activeLoan = await Loan.findOne({
      user: user._id,
      status: { $in: ["pending", "approved", "overdue"] }
    })
      .populate({
        path: "duration",
        model: "LoanSettings"
      })
      .populate({
        path: "guarantors.guarantor",
        model: "User",
        select: "firstName lastName membershipID"
      })
      .lean();

    // Due date based on duration.months
    let dueDate = null;
    let daysUntilDue = null;

    if (activeLoan && activeLoan.duration) {
      const createdAt = new Date(activeLoan.createdAt);
      const monthsToAdd = activeLoan.duration.duration;

      dueDate = new Date(createdAt);
      dueDate.setMonth(dueDate.getMonth() + monthsToAdd);

      const today = new Date();
      const msDiff = dueDate - today;
      daysUntilDue = Math.ceil(msDiff / (1000 * 60 * 60 * 24));

      if (daysUntilDue < 0) daysUntilDue = 0;
    }

    const interestRate = user.account?.accountType?.interestRate || 0;

    const today = new Date();
    const monthsSinceJoin = Math.floor(
      (today - user.createdAt) / (1000 * 60 * 60 * 24 * 30)
    );

    // Settings
    const settings = await Settings.getSettings();
    const companyAccount = settings.companyAccount || {};

    // Pending guarantor requests
    const pendingGuarantorCount = user.guarantorRequests
      ? user.guarantorRequests.filter(r => r.status === "pending").length
      : 0;

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
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const loan = await Loan.findOne({
      user:   req.user._id,
      status: { $in: ["approved", "overdue"] }
    }).populate("duration");

    if (!loan) {
      return res.status(404).json({ message: "No active loan found." });
    }

    const durationMonths = loan.duration?.duration ?? loan.externalDuration ?? 1;
    const interestOwed = parseFloat(
      (loan.amount * (loan.interestRate / 100) * durationMonths).toFixed(2)
    );

    const interestPaymentRecord = await Payment.findOne({
      loanId: loan._id,
      type:   "interest",
      status: { $in: ["paid", "success"] }
    });

    const paidAmountCoversInterest =
      typeof loan.paidAmount === "number" &&
      loan.paidAmount >= interestOwed;

    const interestPaid = !!(interestPaymentRecord || paidAmountCoversInterest);

    const pendingInterest = !interestPaid
      ? await Payment.findOne({
          loanId: loan._id,
          type:   "interest",
          status: "pending"
        })
      : null;

    const outstandingBalance = parseFloat(
      (loan.outstandingBalance || loan.totalRepay).toFixed(2)
    );
    const rolloverPct   = loan.duration?.rolloverPercentage ?? loan.rolloverPercentage ?? 0;
    const rolloverFee   = parseFloat((outstandingBalance * (rolloverPct / 100)).toFixed(2));
    const newTotalRepay = parseFloat((outstandingBalance + rolloverFee).toFixed(2));

    const settings = await Settings.getSettings();

    return res.status(200).json({
      loanId:          loan._id,
      loanName:        loan.duration?.loanName || null,  // CHANGED: added for locked duration display
      interestPaid,
      interestOwed,
      paidAmount:      loan.paidAmount ?? 0,
      pendingInterest: !!pendingInterest,
      outstandingBalance,
      rolloverPct,
      rolloverFee,
      newTotalRepay,
      companyAccount:  settings.companyAccount
    });

  } catch (err) {
    console.error("Rollover status error:", err);
    return res.status(500).json({ message: "Server error." });
  }
});


// ═════════════════════════════════════════════════════════════════════════════
// POST /club-de-star-cooperative/rollover-interest-payment
router.post("/club-de-star-cooperative/rollover-interest-payment", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const { loanId, amount, payerName } = req.body;

    if (!loanId || !amount) {
      return res.status(400).json({ message: "Loan ID and amount are required." });
    }

    const paymentAmount = Math.round(Number(amount));
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      return res.status(400).json({ message: "Invalid amount." });
    }

    const loan = await Loan.findOne({
      _id:    loanId,
      user:   req.user._id,
      status: { $in: ["approved", "overdue"] }
    });

    if (!loan) {
      return res.status(404).json({ message: "Loan not found or not active." });
    }

    const existing = await Payment.findOne({
      loanId: loan._id,
      type:   "interest",
      status: { $in: ["pending", "success", "paid", "approved"] }
    });

    if (existing) {
      return res.status(400).json({
        message: existing.status === "pending"
          ? "An interest payment is already pending admin approval. Please wait."
          : "Interest has already been paid for this loan."
      });
    }

    const reference = `LOAN-INT-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    await Payment.create({
      user:      req.user._id,
      email:     req.user.email,
      loan:      loan._id,
      loanId:    loan._id,
      amount:    paymentAmount,
      reference,
      type:      "interest",
      payeeName: payerName?.trim() || null,
      status:    "pending"
    });

    await Transaction.create({
      user:        req.user._id,
      type:        "loan_payment",
      amount:      paymentAmount,
      description: "Loan interest payment for rollover (Pending admin approval)",
      reference,
      method:      "Manual",
      status:      "pending"
    });

    return res.status(200).json({
      status:  true,
      message: "Interest payment submitted for approval. You will be notified once confirmed."
    });

  } catch (err) {
    console.error("Rollover interest payment error:", err);
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