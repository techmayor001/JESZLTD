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

    const settings = await Settings.getSettings();
    const registrationFee = settings.registrationFees.adultRegistrationFee;
    const companyAccount  = settings.companyAccount;

    res.render("auth/auth", {
      referralCode,
      registrationFee,
      companyAccount,   // { bankName, accountNumber, accountName }
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

    console.log("Member Savings:",   memberSavings);
    console.log("Accumulative ROI:", accumulativeROI);
    console.log("Total Balance:",    totalBalance);

    // Monthly ROI
    const currentMonthKey = getCurrentMonthKey();
    let monthlyROI = 0;
    if (user.account?.monthlyRoiHistory?.length) {
      monthlyROI = user.account.monthlyRoiHistory
        .filter(m => m.month === currentMonthKey)
        .reduce((sum, m) => safeAddMoney(sum, Number(m.roi || 0)), 0);
    }
    console.log("Monthly ROI:", monthlyROI);

    // ── Total savings across all member accounts (ownerType: "User" only) ──
    // Kiddies accounts are excluded — they are tracked separately.
    const allMemberAccounts = await Account.find({ ownerType: "User" });

    const totalSavingsAllMembers = allMemberAccounts.reduce(
      (sum, acc) => sum + Number(acc.balance || 0), 0
    );
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

    const monthsSinceJoin = Math.floor(
      (new Date() - user.createdAt) / (1000 * 60 * 60 * 24 * 30)
    );

    // ── Active loan ───────────────────────────────────────────────────────────
    const activeLoan = await Loan.findOne({
      user:   user._id,
      status: { $in: ["approved", "overdue"] }
    }).populate("duration");

    const loanIsOverdue    = activeLoan?.status === "overdue"     || false;
    const loanTotalPenalty = Number(activeLoan?.totalPenalty      || 0);
    const loanOutstanding  = Number(
      activeLoan?.outstandingBalance || activeLoan?.totalRepay    || 0
    );
    const loanPenaltyRate  = Number(activeLoan?.penaltyPercentage || 0);

    console.log("Active Loan:",        activeLoan?._id || "none");
    console.log("Loan Is Overdue:",    loanIsOverdue);
    console.log("Loan Outstanding:",   loanOutstanding);
    console.log("Loan Total Penalty:", loanTotalPenalty);
    console.log("Loan Penalty Rate:",  loanPenaltyRate);

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
    console.log("User Role:",                user.role?.name);
    console.log("User Permissions Count:",   user.role?.permissions?.length || 0);

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

      loan:             activeLoan,
      loanIsOverdue,
      loanTotalPenalty,
      loanOutstanding,
      loanPenaltyRate,

      interestRate,

      companyAccount,
      maintenanceMode,
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
        populate: { path: "accountType" }
      })
      .populate("loans")
      .populate("referredUsers")
      .exec();

    if (!user) return res.redirect("/login");

    const accountBalance = user.account?.balance || 0;
    const activeLoan = user.loans.find(l => l.status === "active") || null;
    const ROI = user.account?.monthlyROI || 0;
    const totalReferrals = user.referredUsers.length;
    const memberType = user.account?.accountType || null;

    // ── ADD THIS ──
    const pendingGuarantorCount = user.guarantorRequests
      ? user.guarantorRequests.filter(r => r.status === "pending").length
      : 0;

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
      memberType,
      accountBalance,
      loan: activeLoan,
      ROI,
      totalReferrals,
      pendingGuarantorCount,   // ← ADD
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


// REPORT PAGE STARTS HERE 
// ══════════════════════════════════════════════════
//  REPORT ROUTES — paste these into your router file
// ══════════════════════════════════════════════════

// ── Financial Report (deposits, withdrawals, ROI) ──
router.get('/cds-cooperative/report', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.redirect('/login');

    const user = await User.findById(req.user._id)
      .populate({ path: 'account', populate: { path: 'accountType' } })
      .populate('loans')
      .exec();

    if (!user) return res.redirect('/login');

    const pendingGuarantorCount = user.guarantorRequests
      ? user.guarantorRequests.filter(r => r.status === 'pending').length : 0;

    // Fetch all transactions for this user
    // Replace 'Transaction' with your actual model name
    const transactions = await Transaction.find({ user: user._id })
      .sort({ createdAt: -1 })
      .lean();

    const accountBalance = user.account?.balance || 0;

    // ROI / pool data — reuse the same logic as your dashboard route
    const allMembersTotalSavings = await Account.aggregate([
      { $group: { _id: null, total: { $sum: '$balance' } } }
    ]).then(r => r[0]?.total || 0);

    const totalInterestCollected = await Transaction.aggregate([
      { $match: { type: 'roi' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).then(r => r[0]?.total || 0);

    const roiOperatingCharge = 20; // % — adjust to your setting
    const companyCharge      = totalInterestCollected * (roiOperatingCharge / 100);
    const netInterestForRoi  = totalInterestCollected - companyCharge;
    const sharePercentage    = allMembersTotalSavings > 0
      ? ((accountBalance / allMembersTotalSavings) * 100).toFixed(2) : 0;
    const interestRate       = user.account?.accountType?.loanInterestRate || 5;
    const monthlyROI         = netInterestForRoi * (parseFloat(sharePercentage) / 100);

    res.render('dashboard/user/report', {
      user,
      transactions,
      pendingGuarantorCount,
      accountBalance,
      monthlyROI,
      interestRate,
      sharePercentage,
      totalInterestCollected,
      netInterestForRoi,
      companyCharge,
      roiOperatingCharge,
    });
  } catch (err) {
    console.error('Financial report error:', err);
    res.status(500).send('Error loading financial report.');
  }
});


// ── Loan Report ──
router.get('/cds-cooperative/loan-report', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.redirect('/login');

    const user = await User.findById(req.user._id)
      .populate({ path: 'account', populate: { path: 'accountType' } })
      .populate('loans')
      .exec();

    if (!user) return res.redirect('/login');

    const pendingGuarantorCount = user.guarantorRequests
      ? user.guarantorRequests.filter(r => r.status === 'pending').length : 0;

    // All loans for this user (populated with duration/loanType if needed)
    const loans = await Loan.find({ user: user._id })
      .sort({ createdAt: -1 })
      .lean();

    const activeLoan = loans.find(l => l.status === 'active' || l.status === 'overdue') || null;

    // Repayment transactions linked to any of the user's loans
    // Replace 'LoanPayment' with your actual payment/transaction model
    const loanPayments = await Transaction.find({
      user: user._id,
      type: 'loan-repayment',
    }).sort({ createdAt: -1 }).lean();

    // Days until due for active loan
    let daysUntilDue = null;
    if (activeLoan && activeLoan.dueDate) {
      const diff = new Date(activeLoan.dueDate) - new Date();
      daysUntilDue = Math.ceil(diff / (1000 * 60 * 60 * 24));
    }

    const interestRate = user.account?.accountType?.loanInterestRate || 5;

    res.render('dashboard/user/loan-report', {
      user,
      loans,
      activeLoan,
      loanPayments,
      pendingGuarantorCount,
      interestRate,
      daysUntilDue,
    });
  } catch (err) {
    console.error('Loan report error:', err);
    res.status(500).send('Error loading loan report.');
  }
});





module.exports = router;