const express = require("express"); 
const router = express.Router();
const User = require("../models/User");
const Payment = require("../models/Payment");
const Account = require("../models/Account");
const Transaction = require("../models/Transaction");
const Settings = require("../models/Settings");
const Loan = require("../models/Loan");
const LoanSettings = require("../models/LoanSettings");
const CompanyROI = require("../models/companyRoiSchema");
const Withdrawal = require("../models/Withdrawal");
const Role = require("../models/Role");
const Permission = require("../models/Permission");
const CompanyLedger = require("../models/CompanyLedger");




router.get('/', (req,res)=>{
    res.render("static/index")
})

router.get('/gallery', (req,res)=>{
    res.render("gallery")
})

router.get('/about-us', (req,res)=>{
    res.render("about")
})



router.get('/cds-cooperative', async (req, res) => {
  try {
    const referralCode = req.query.ref || "";

    // Fetch settings (create default if not exists)
    const settings = await Settings.getSettings();
    const registrationFee = settings.registrationFees.adultRegistrationFee;

    // Render the page and pass registration fee
    res.render("auth/auth", { 
      referralCode,
      registrationFee 
    });
  } catch (err) {
    console.error("Error fetching settings:", err);
    res.status(500).send("Internal Server Error");
  }
});

router.get('/onboard/club-de-star-cooperative/bylaws', async (req, res) => {
  try {
    const referralCode = req.query.ref || "";

    // Fetch settings (create default if not exists)
    const settings = await Settings.getSettings();
    const registrationFee = settings.registrationFees.adultRegistrationFee;

    // Render the page and pass registration fee
    res.render("auth/bylaws", { 
      referralCode,
      registrationFee 
    });
  } catch (err) {
    console.error("Error fetching settings:", err);
    res.status(500).send("Internal Server Error");
  }
});




router.get("/cds-cooperative/dashboard", async (req, res) => {

  function getCurrentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  function safeAddMoney(a, b) {
    return (Math.round(a * 100) + Math.round(b * 100)) / 100;
  }

  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    const user = await User.findById(req.user._id)
      .populate({
        path: "account",
        populate: { path: "accountType", model: "MemberType" }
      })
      .populate("referredUsers")
      .exec();

    if (!user) {
      console.error("User not found");
      return res.redirect("/login");
    }

    // Merge role from req.user (already populated by Passport)
    user.role = req.user.role;

    const users = await User.find({}).populate("account");

    const memberSavings   = Number(user.account?.balance || 0);
    const accumulativeROI = Number(user.account?.accumulativeROI || 0);
    const totalBalance    = safeAddMoney(memberSavings, accumulativeROI);

    console.log("Member Savings:",    memberSavings);
    console.log("Accumulative ROI:",  accumulativeROI);
    console.log("Total Balance:",     totalBalance);

    // Monthly ROI
    const currentMonthKey = getCurrentMonthKey();
    let monthlyROI = 0;
    if (user.account?.monthlyRoiHistory?.length) {
      monthlyROI = user.account.monthlyRoiHistory
        .filter(m => m.month === currentMonthKey)
        .reduce((sum, m) => safeAddMoney(sum, Number(m.roi || 0)), 0);
    }
    console.log("Monthly ROI:", monthlyROI);

    const accounts = users
      .map(u => u.account)
      .filter(acc => acc)
      .map(acc => ({ userId: acc.user.toString(), balance: Number(acc.balance || 0) }));

    const totalSavingsAllMembers = accounts.reduce((sum, acc) => sum + acc.balance, 0);
    console.log("Total Savings of All Members:", totalSavingsAllMembers);

    const latestROI              = await CompanyROI.findOne().sort({ createdAt: -1 });
    const totalInterestCollected = Number(latestROI?.totalInterestCollected || 0);
    const companyCharge          = Number(latestROI?.companyCharge          || 0);
    const netInterestForRoi      = Number(latestROI?.netInterestForRoi      || 0);

    console.log("Total Interest Collected:", totalInterestCollected);
    console.log("Company Charge (ROI):",     companyCharge);
    console.log("Net Interest for ROI:",     netInterestForRoi);

    // Load settings dynamically
    const settings           = await Settings.getSettings();
    const roiOperatingCharge = Number(settings.otherFees.roiOperatingCharge || 0);
    console.log("ROI Operating Charge from Settings:", roiOperatingCharge);

    // ── NEW: destructure company account & maintenance mode from settings ──
    const companyAccount  = settings.companyAccount  || {};
    const maintenanceMode = settings.maintenanceMode || { enabled: false, message: "" };

    // User share calculation
    let sharePercentageDisplay = 0;
    if (totalSavingsAllMembers > 0 && memberSavings > 0) {
      const rawShare         = (memberSavings / totalSavingsAllMembers) * 100;
      const shareAfterCharge = rawShare - roiOperatingCharge;
      sharePercentageDisplay = Math.max(0, Number(shareAfterCharge.toFixed(2)));
    }
    console.log("User Share % after company charge:", sharePercentageDisplay);

    // ROI calculation
    let ROI = 0, userShare = 0, companyChargeOnUser = 0;
    if (totalSavingsAllMembers > 0 && totalInterestCollected > 0 && memberSavings > 0) {
      userShare           = (memberSavings / totalSavingsAllMembers) * totalInterestCollected;
      companyChargeOnUser = userShare * (roiOperatingCharge / 100);
      ROI                 = userShare - companyChargeOnUser;
    }

    const ROI_display           = Number(ROI.toFixed(2));
    const userShare_display     = Number(userShare.toFixed(2));
    const companyCharge_display = Number(companyChargeOnUser.toFixed(2));

    const monthsSinceJoin = Math.floor((new Date() - user.createdAt) / (1000 * 60 * 60 * 24 * 30));

    // ── Active loan — include overdue loans ──────────────────────────
    const activeLoan = await Loan.findOne({
      user:   user._id,
      status: { $in: ["approved", "overdue"] }
    }).populate("duration");

    // ── Penalty / outstanding props for the dashboard ────────────────
    const loanIsOverdue    = activeLoan?.status === "overdue"      || false;
    const loanTotalPenalty = Number(activeLoan?.totalPenalty       || 0);
    const loanOutstanding  = Number(
      activeLoan?.outstandingBalance || activeLoan?.totalRepay      || 0
    );
    const loanPenaltyRate  = Number(activeLoan?.penaltyPercentage  || 0);

    console.log("Active Loan:",         activeLoan?._id || "none");
    console.log("Loan Is Overdue:",     loanIsOverdue);
    console.log("Loan Outstanding:",    loanOutstanding);
    console.log("Loan Total Penalty:",  loanTotalPenalty);
    console.log("Loan Penalty Rate:",   loanPenaltyRate);

    const interestRate = user.account?.accountType?.interestRate || 0;

    const currentYear = new Date().getFullYear();
    const forcefulWithdrawalCount = await Withdrawal.countDocuments({
      user: req.user._id,
      type: "forceful",
      createdAt: {
        $gte: new Date(`${currentYear}-01-01`),
        $lte: new Date(`${currentYear}-12-31`)
      }
    });

    console.log("Forceful Withdrawal Count:", forcefulWithdrawalCount);
    console.log("User Role:",               user.role?.name);
    console.log("User Permissions Count:",  user.role?.permissions?.length || 0);

    res.render("dashboard/user/user-dashboard", {
      user,
      users,

      accountBalance:  memberSavings,
      accumulativeROI,
      totalBalance,

      monthlyROI,
      sharePercentage: sharePercentageDisplay,

      allMembersTotalSavings: totalSavingsAllMembers,

      forceWithdrawalCharge:  settings.otherFees.forceWithdrawalCharge || 2.5,
      forcefulWithdrawalCount,
      roiOperatingCharge,

      totalInterestCollected,
      companyCharge,
      netInterestForRoi,

      userShare:           userShare_display,
      companyChargeOnUser: companyCharge_display,
      ROI:                 ROI_display,

      monthsSinceJoin,

      // Loan data
      loan:             activeLoan,
      loanIsOverdue,
      loanTotalPenalty,
      loanOutstanding,
      loanPenaltyRate,

      interestRate,

      // ── NEW ──
      companyAccount,   // { bankName, accountNumber, accountName }
      maintenanceMode,  // { enabled, message, enabledAt, enabledBy }
    });

  } catch (err) {
    console.error("Dashboard fetch error:", err);
    res.redirect("/login");
  }
});




// HANDLING WITHDRAWAL REQUESTS 
router.post("/withdraw", async (req, res) => {
  try {
    const userId = req.user._id;
    const { type, amount } = req.body;

    /* ❌ BASIC VALIDATION */
    if (!type || !amount || Number(amount) <= 0) {
      return res.status(400).json({
        message: "Invalid withdrawal data"
      });
    }

    /* 🔍 FETCH USER + ACCOUNT + LOANS */
    const user = await User.findById(userId)
      .populate("account")
      .populate({
        path: "loans",
        match: { status: { $in: ["pending", "approved"] } } // ✅ FIXED
      });

    if (!user || !user.account) {
      return res.status(404).json({
        message: "User account not found"
      });
    }

    /* ❌ ACTIVE LOAN CHECK */
    if (user.loans && user.loans.length > 0) {
      return res.status(403).json({
        message: "You cannot withdraw while you have an active loan"
      });
    }

    /* ❌ GUARANTOR ACTIVE LOAN CHECK */
    const activeGuaranteedLoan = await Loan.findOne({
      guarantors: {
        $elemMatch: {
          guarantor: userId,
          status: "accepted"
        }
      },
      status: { $in: ["pending", "approved"] }
    });

    if (activeGuaranteedLoan && Number(amount) >= user.account.balance) {
      return res.status(403).json({
        message:
          "You cannot withdraw your full balance while you are a guarantor on an active loan"
      });
    }

    /* ❌ BANK DETAILS CHECK */
    if (
      !user.bankDetails ||
      !user.bankDetails.bankName ||
      !user.bankDetails.accountNumber ||
      !user.bankDetails.accountName
    ) {
      return res.status(400).json({
        message: "Please update your bank details before requesting withdrawal"
      });
    }

    /* ❌ REGULAR WITHDRAWAL WINDOW */
    if (type === "regular") {
      const today = new Date();
      const day = today.getDate();
      const month = today.getMonth(); // December = 11

      if (month !== 11 || day < 1 || day > 10) {
        return res.status(403).json({
          message:
            "Regular withdrawals are only allowed between December 1st and 10th"
        });
      }
    }

    /* ❌ BALANCE CHECK */
    if (Number(amount) > user.account.balance) {
      return res.status(400).json({
        message: "Insufficient balance"
      });
    }

    /* 🏷 MAP FRONTEND TYPE → DB TYPE */
    const withdrawalType = type === "force" ? "forceful" : "normal";

    const description =
      withdrawalType === "forceful"
        ? "Forceful withdrawal request"
        : "Regular withdrawal request";

    /* 🔐 GENERATE REFERENCE */
    const reference = `WD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    /* 🧾 CREATE WITHDRAWAL */
    const withdrawal = await Withdrawal.create({
      user: userId,
      amount: Number(amount),
      reference,
      bankName: user.bankDetails.bankName,
      accountName: user.bankDetails.accountName,
      accountNumber: user.bankDetails.accountNumber,
      type: withdrawalType,
      status: "pending"
    });

    /* 🧾 RECORD TRANSACTION */
    const transaction = await Transaction.create({
      user: userId,
      type: "withdrawal",
      amount: Number(amount),
      status: "pending",
      method: "manual",
      reference,
      description
    });

    return res.status(201).json({
      message: "Withdrawal request submitted successfully",
      withdrawalId: withdrawal._id,
      transactionId: transaction._id
    });

  } catch (err) {
    /* 🔥 FULL DEBUG */
    console.error("Withdrawal Error:", err);

    return res.status(500).json({
      message: err.message || "Unable to process withdrawal"
    });
  }
});
// ENDS -------------- EDISON OVICIAL 






router.get("/cds-cooperative/transaction", async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.redirect("/login");
    }

    const user = req.user;

    // Fetch transactions, latest first
    const transactions = await Transaction.find({ user: user._id }).sort({ createdAt: -1 });

    // Fetch user account
    const account = await Account.findOne({ user: user._id });

    // --- Calculate dynamic statistics ---
    let totalDeposits = 0;
    let totalWithdrawals = 0;
    let totalLoanPayments = 0;

    transactions.forEach(tx => {
      if (tx.type === 'deposit') totalDeposits += tx.amount;
      else if (tx.type === 'withdrawal') totalWithdrawals += tx.amount;
      else if (tx.type === 'loan_payment') totalLoanPayments += tx.amount;
    });

    const roiEarned = account?.accumulativeROI || 0;

    // Render template with statistics
    res.render("dashboard/user/transaction", {
      user,
      account,
      transactions,
      totalDeposits,
      totalWithdrawals,
      totalLoanPayments,
      roiEarned
    });

  } catch (err) {
    console.error("Transaction fetch error:", err);
    res.status(500).send("Error fetching transactions.");
  }
});


// LOAN ROUTE 
router.get("/cds-cooperative/loan", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    // Fetch logged-in user
    const user = await User.findById(req.user._id)
      .populate({
        path: "account",
        populate: { path: "accountType", model: "MemberType" }
      });

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
      status: { $in: ["pending", "approved"] }
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

    // === ✅ DUE DATE BASED ON duration.months ===
    let dueDate = null;
    let daysUntilDue = null;

    if (activeLoan && activeLoan.duration) {
      const createdAt = new Date(activeLoan.createdAt);
      const monthsToAdd = activeLoan.duration.duration; // <--- number of months

      // Add the loan duration (months)
      dueDate = new Date(createdAt);
      dueDate.setMonth(dueDate.getMonth() + monthsToAdd);

      // Calculate days left
      const today = new Date();
      const msDiff = dueDate - today;
      daysUntilDue = Math.ceil(msDiff / (1000 * 60 * 60 * 24));

      if (daysUntilDue < 0) daysUntilDue = 0; // overdue handling
    }

    const interestRate = user.account?.accountType?.interestRate || 0;

    // Account age in months
    const today = new Date();
    const monthsSinceJoin = Math.floor(
      (today - user.createdAt) / (1000 * 60 * 60 * 24 * 30)
    );

    res.render("dashboard/user/loan", {
      user,
      users,
      loan: activeLoan,
      interestRate,
      monthsSinceJoin,
      loanSettings,
      dueDate,
      daysUntilDue
    });

  } catch (err) {
    console.error("Loan page error:", err);
    res.redirect("/club-de-star-cooperative/dashboard");
  }
});

// LOAN APPLICATION ROUTE
router.post("/club-de-star-cooperative/apply-loan", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    let { amount, duration, guarantor1, guarantor2, agreeTerms } = req.body;

    // 🔒 Force numeric conversion
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

    if (!user || !user.account || !user.account.accountType) {
      return res.status(400).json({ message: "User account type not set." });
    }

    // Prevent multiple active loans
    const existingLoan = await Loan.findOne({
      user: user._id,
      status: { $in: ["pending", "approved"] }
    });

    if (existingLoan) {
      return res.status(400).json({
        message: "You already have an active or pending loan."
      });
    }

    // Get loan duration settings
    const loanSetting = await LoanSettings.findById(duration);
    if (!loanSetting) {
      return res.status(400).json({ message: "Invalid loan duration selected." });
    }

    const durationValue = Number(loanSetting.duration);
    const durationUnit  = loanSetting.durationUnit || "months";

    if (isNaN(durationValue) || durationValue <= 0) {
      return res.status(400).json({ message: "Invalid loan duration value." });
    }

    // ── Interest Calculation ─────────────────────────────────────────
    // Monthly interest rate from MemberType
    const interestRate = Number(user.account.accountType.interestRate); // %

    const interestAmount = amount * (interestRate / 100) * durationValue;
    const totalRepay     = Math.round(amount + interestAmount);

    // ── NOTE: dueDate is NOT set here. ──────────────────────────────
    // It will be correctly computed from the actual disbursementDate
    // when an admin approves the loan. Storing a provisional dueDate
    // at application time is misleading and causes penalty timing bugs.

    const loan = await Loan.create({
      user: user._id,
      amount,
      totalRepay,
      interestRate,
      duration,       // LoanSettings ID
      status:         "pending",
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
        loan:     loan._id,
        amount
      });

      gUser.guarantorRequestStats.totalReceived += 1;
      await gUser.save();
    }));

    return res.status(200).json({
      message:           "Loan application submitted successfully.",
      amount,
      interestRate,
      durationValue,
      durationUnit,
      totalRepay
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




// ENDS 



// ROI ROUTE 
router.get("/club-de-star-cooperative/roiCalculator", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    // Fetch full user data
    const user = await User.findById(req.user._id)
      .populate("loans")
      .populate("account")
      .exec();

    if (!user) return res.redirect("/login");

    // Fetch all users (for reference display)
    const users = await User.find({});

    // --- 1. User account balance ---
    const accountBalance = user.account?.balance || 0;
    const monthlyROI = user.account?.monthlyROI || 0;
    const accumulativeROI = user.account?.accumulativeROI || 0;

    // --- 2. Total savings from all members ---
    const allAccounts = await Account.find({});
    const allMembersTotalSavings = allAccounts.reduce(
      (sum, acc) => sum + (acc.balance || 0),
      0
    );

    // --- 3. Total interests from approved loans ---
    const allLoans = await Loan.find({ status: "approved" })
      .populate("user account");

    const totalLoanInterest = allLoans.reduce((sum, loan) => {
      const rate = loan.user.account.accountType === "CD" ? 0.05 : 0.10;
      return sum + loan.amount * rate;
    }, 0);

    // --- 4. ROI calculation for THIS user ---
    const ROI = allMembersTotalSavings > 0
      ? (accountBalance / allMembersTotalSavings) * totalLoanInterest * 0.9
      : 0;

    // Render ROI calculator page
    res.render("dashboard/roi", {
      user,
      users,
      ROI,
      accountBalance,
      monthlyROI,
      accumulativeROI,
      allMembersTotalSavings,
      totalLoanInterest
    });

  } catch (err) {
    console.error("ROI Calculator error:", err);
    res.redirect("/club-de-star-cooperative/dashboard");
  }
});

// ENDS 


// Profile route
router.get("/cds-cooperative/profile", async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.redirect("/login");

    const user = await User.findById(req.user._id)
      .populate({
        path: "account",
        populate: { path: "accountType" }  // ← populates the MemberType document
      })
      .populate("loans")
      .populate("referredUsers")
      .exec();

    if (!user) return res.redirect("/login");

    const accountBalance = user.account?.balance || 0;
    const activeLoan = user.loans.find(l => l.status === "active") || null;
    const ROI = user.account?.monthlyROI || 0;
    const totalReferrals = user.referredUsers.length;

    // Pull memberType fields cleanly for the template
    const memberType = user.account?.accountType || null;

    const nigeriaBanks = [
      "Access Bank", "Citibank Nigeria", "Ecobank Nigeria", "Fidelity Bank",
      "First Bank of Nigeria", "FCMB", "GTB", "Heritage Bank", "Keystone Bank",
      "Providus Bank", "Polaris Bank", "Stanbic IBTC", "Standard Chartered",
      "Sterling Bank", "SunTrust Bank", "Union Bank", "UBA", "Unity Bank",
      "Wema Bank", "Zenith Bank",
      "Opay", "Kuda Bank", "ALAT by Wema", "Rubies Bank", "FairMoney",
      "Carbon", "V Bank", "Aella Credit", "PalmPay", "Paycom", "Chipper Cash", "Flutterwave"
    ];

    res.render("dashboard/user/profile", {
      user,
      memberType,        // ← MemberType document, fully populated
      accountBalance,
      loan: activeLoan,
      ROI,
      totalReferrals,
      success: req.query.success || null,
      error: req.query.error || null,
      nigeriaBanks
    });
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).send("Error fetching profile details.");
  }
});

router.get("/cds-cooperative/kyc", async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.redirect("/login");

    const user = await User.findById(req.user._id)
      .populate("account")
      .exec();

    if (!user) return res.redirect("/login");

    const accountBalance = user.account?.balance || 0;

    const hasAllKycDocs = Boolean(
      user.addressProof &&
      user.passportPhoto &&
      user.idType &&
      user.idNumber &&
      user.idFile &&
      user.signature
    );

    const kycStatus = hasAllKycDocs ? "submitted" : "not_submitted";

    // ✅ Normalize stored paths → web URLs
    // "public\\media\\uploads\\file.jpg" → "/media/uploads/file.jpg"
    const normalizeDocPath = (p) => {
      if (!p) return null;
      return '/' + p.replace(/\\/g, '/').replace(/^public\//, '');
    };

    const kycDocs = {
      addressProof:  normalizeDocPath(user.addressProof),
      passportPhoto: normalizeDocPath(user.passportPhoto),
      idFile:        normalizeDocPath(user.idFile),
      signature:     normalizeDocPath(user.signature),
    };

    res.render("dashboard/user/kyc", {
      user,
      kycDocs,      // ← clean URLs ready for <img src> / <iframe src>
      accountBalance,
      kycStatus,
      success: req.query.success || null,
      error: req.query.error || null
    });

  } catch (err) {
    console.error("KYC page error:", err);
    res.status(500).send("Error loading KYC page");
  }
});
// ENDS 

// REFERRAL ROUTE
router.get("/cds-cooperative/referral", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    // --- Fetch user with referral population ---
    const user = await User.findById(req.user._id)
      .populate("referredUsers")
      .populate("account")
      .exec();

    if (!user) return res.redirect("/login");

    // --- Referral Program ---
    const referralCode = user.referralCode;

    const referralLink = `${req.protocol}://${req.get("host")}/onboard/club-de-star-cooperative?ref=${referralCode}`;

    const totalReferrals = user.referredUsers.length;

    // ₦5,000 per referral
    const referralEarning = totalReferrals * 5000;

    // Render referral page
    res.render("dashboard/user/referral", {
      user,
      referralCode,
      referralLink,
      totalReferrals,
      referralEarning,
      referredUsers: user.referredUsers,
    });

  } catch (err) {
    console.error("Referral route error:", err);
    res.redirect("/club-de-star-cooperative/dashboard");
  }
});
// ENDS 

// TERMS AND CONDITIONS ROUTE 
router.get("/cds-cooperative/memberContract", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    // Fetch user + account + loans + referrals
    const user = await User.findById(req.user._id)
      .populate("loans")
      .populate("account")
      .populate("referredUsers")
      .exec();

    if (!user) return res.redirect("/login");

    // Render the contract page
    res.render("dashboard/user/member-contract", {
      user
    });

  } catch (err) {
    console.error("Member Contract page error:", err);
    res.redirect("/club-de-star-cooperative/dashboard");
  }
});

// ENDS 

// UPDATE NEXT OF KIN DETAILS
router.post('/update-next-of-kin', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/login');
  }

  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.redirect('/club-de-star-cooperative/profile');
    }

    // Ensure nextOfKin exists
    if (!user.nextOfKin) user.nextOfKin = {};

    // Update only fields that are sent in the form
    Object.keys(req.body).forEach(field => {
      if (req.body[field] !== undefined) {
        user.nextOfKin[field] = req.body[field];
      }
    });

    user.updatedAt = new Date();
    await user.save();

    return res.redirect('/club-de-star-cooperative/profile');

  } catch (err) {
    console.error("Update Next of Kin error:", err);
    return res.redirect('/club-de-star-cooperative/profile');
  }
});



// ADMIN DASHBOARD ---------------------TECHMAYOR CO 

// Middleware to protect routes for admin/staff/superadmin
function ensureAdmin(req, res, next) {
  if (req.isAuthenticated() && ["admin", "staff", "superadmin"].includes(req.user.role)) {
    return next();
  }
  return res.status(403).send("Access denied. Admins only.");
}


// REPORT PAGE STARTS HERE 
router.get('/user/report', (req,res)=>{
  res.render("dashboard/report")
})





module.exports = router;