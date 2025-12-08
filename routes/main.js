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




router.get('/', (req,res)=>{
    res.render("index")
})

router.get('/gallery', (req,res)=>{
    res.render("gallery")
})

router.get('/about-us', (req,res)=>{
    res.render("about")
})



router.get('/onboard/club-de-star-cooperative', async (req, res) => {
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



// router.get('/club-de-star-cooperative/dashboard', (req,res)=>{
//     res.render("dashboard/user-dashboard")
// })

router.get("/club-de-star-cooperative/dashboard", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    // 1) Fetch user with account (and accountType for interest display)
    const user = await User.findById(req.user._id)
      .populate({
        path: "account",
        populate: { path: "accountType", model: "MemberType" }
      })
      .populate("referredUsers")
      .exec();

    if (!user) return res.redirect("/login");

    // 2) Fetch all users (for dropdowns etc)
    const users = await User.find({});

    // 3) Member's savings and account info
    const memberSavings = Number(user.account?.balance || 0);
    const monthlyROI = Number(user.account?.monthlyROI || 0);
    const accumulativeROI = Number(user.account?.accumulativeROI || 0);

    // 4) Total savings by all members
// Fetch all users with accounts
const accounts = await Account.find({}).populate("user");

// Sum all account balances ONLY if the user exists (prevents null/invalid refs)
const totalSavingsAllMembers = accounts.reduce((sum, acc) => {
  if (acc.user) {
    return sum + (Number(acc.balance) || 0);
  }
  return sum;
}, 0);


    console.log(totalSavingsAllMembers)

    // 5) Get latest CompanyROI and read totalInterestCollected
    const latestROI = await CompanyROI.findOne().sort({ createdAt: -1 });
    const totalInterestCollected = Number(latestROI?.totalInterestCollected || 0);
    
    const companyCharge = Number(latestROI?.companyCharge || 0);
    const netInterestForRoi = Number(latestROI?.netInterestForRoi || 0);
    console.log(totalInterestCollected);

    

    // 6) Apply your exact formula:
    // ROI = (memberSavings / totalSavingsAllMembers) * totalInterestCollected - 10%(company charge on user's share)
    // which simplifies to: ROI = (memberSavings / totalSavingsAllMembers) * totalInterestCollected * 0.9
    let ROI = 0;
    let userShare = 0;
    let companyChargeOnUser = 0;

    if (totalSavingsAllMembers > 0 && totalInterestCollected > 0 && memberSavings > 0) {
      userShare = (memberSavings / totalSavingsAllMembers) * totalInterestCollected;
      companyChargeOnUser = userShare * 0.10; // 10%
      ROI = userShare - companyChargeOnUser;
    }

    // Round values to 2 decimal places for display (avoid floating point oddities)
    const ROI_display = Number(ROI.toFixed(2));
    const userShare_display = Number(userShare.toFixed(2));
    const companyCharge_display = Number(companyChargeOnUser.toFixed(2));

    // 7) Months since registration
    const today = new Date();
    const monthsSinceJoin = Math.floor(
      (today - user.createdAt) / (1000 * 60 * 60 * 24 * 30)
    );

    // 8) Fetch user's active loan (if any) — user can only have one active loan
    const activeLoan = await Loan.findOne({
      user: user._id,
      status: "approved"
    })
      .populate("duration")
      .exec();

    // 9) Interest rate for display (from member type)
    const interestRate = user.account?.accountType?.interestRate || 0;

    // 10) Render dashboard
    res.render("dashboard/user-dashboard", {
      user,
      users,
      accountBalance: memberSavings,
      monthlyROI,
      accumulativeROI,
      allMembersTotalSavings: totalSavingsAllMembers,

      // Company-level values used
      totalInterestCollected,
      companyCharge,
      netInterestForRoi,

      // Per-user ROI breakdown
      userShare: userShare_display,
      companyChargeOnUser: companyCharge_display,
      ROI: ROI_display,

      monthsSinceJoin,
      loan: activeLoan,
      interestRate
    });

  } catch (err) {
    console.error("Dashboard fetch error:", err);
    res.redirect("/login");
  }
});








router.get("/club-de-star-cooperative/transaction", async (req, res) => {
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
    res.render("dashboard/transaction", {
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
router.get("/club-de-star-cooperative/loan", async (req, res) => {
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

    res.render("dashboard/loan", {
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

        return res.redirect("/club-de-star-cooperative/loan");
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

router.post("/club-de-star-cooperative/apply-loan", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    const { amount, duration, guarantor1, guarantor2, agreeTerms } = req.body;

    // Basic sanity check for guarantors
    if (guarantor1 === guarantor2) {
      return res.status(400).send("You cannot select the same guarantor twice.");
    }

    // Fetch user with populated account and accountType
    const user = await User.findById(req.user._id)
      .populate({
        path: "account",
        populate: { path: "accountType" } // populate MemberType for interest rate
      });

    if (!user) return res.status(404).send("User not found.");

    // Fetch LoanSettings for selected duration
    const loanSetting = await LoanSettings.findById(duration);
    if (!loanSetting) return res.status(400).send("Invalid loan type selected.");

    // Get interest rate from account type
    const interestRate = user.account.accountType.interestRate;

    // Calculate total repayment
    const totalRepay = parseFloat(amount) + (parseFloat(amount) * interestRate / 100);

    // Create Loan document
    const loan = new Loan({
      user: user._id,
      amount: parseFloat(amount),
      totalRepay,
      interestRate,
      duration: loanSetting._id,
      status: "pending", // waiting for guarantor approval
      guarantors: [
        { guarantor: guarantor1 },
        { guarantor: guarantor2 }
      ]
    });

    await loan.save();

    // Create guarantor requests for each guarantor
    const createGuarantorRequest = async (guarantorId) => {
      const guarantorUser = await User.findById(guarantorId);
      if (!guarantorUser) return;

      guarantorUser.guarantorRequests.push({
        borrower: user._id,
        loan: loan._id,
        amount: parseFloat(amount)
      });

      // Update stats
      guarantorUser.guarantorRequestStats.totalReceived += 1;
      await guarantorUser.save();
    };

    await Promise.all([
      createGuarantorRequest(guarantor1),
      createGuarantorRequest(guarantor2)
    ]);

    res.status(200).send({ message: "Loan application submitted successfully.", loanId: loan._id });

  } catch (err) {
    console.error("Loan application error:", err);
    res.status(500).send("An error occurred while applying for the loan.");
  }
});

router.post("/club-de-star-cooperative/rollover-loan", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    const { duration, amount } = req.body;

    if (!duration || !amount)
      return res.status(400).send("Missing rollover parameters.");

    // 1️⃣ Fetch user
    const user = await User.findById(req.user._id).populate({
      path: "account",
      populate: { path: "accountType" }
    });
    if (!user) return res.status(404).send("User not found.");

    // 2️⃣ Get user's current active loan
    const oldLoan = await Loan.findOne({
      user: user._id,
      status: "approved"
    }).populate("duration");
    if (!oldLoan) return res.status(400).send("No active loan to roll over.");

    // 3️⃣ Fetch LoanSettings for selected duration
    const loanSetting = await LoanSettings.findById(duration);
    if (!loanSetting) return res.status(400).send("Invalid loan duration.");

    const principalAmount = parseFloat(amount);

    // 4️⃣ Calculate new interest
    const accountInterest = user.account.accountType.interestRate || 0;
    const rolloverInterest = loanSetting.rolloverPercentage || 0;
    const totalInterestRate = accountInterest + rolloverInterest;

    const totalInterest = (principalAmount * totalInterestRate) / 100;
    const totalRepay = principalAmount + totalInterest;

    // 5️⃣ Carry guarantors from old loan as accepted
    const newGuarantors = oldLoan.guarantors.map(g => ({
      guarantor: g.guarantor,
      status: "accepted"
    }));

    // 6️⃣ Create new rollover loan (pending admin approval)
    const newLoan = new Loan({
      user: user._id,
      amount: principalAmount,
      interestRate: totalInterestRate,
      totalRepay,
      duration: loanSetting._id,
      status: "pending",
      guarantors: newGuarantors,
      isRollover: true,
      previousLoan: oldLoan._id
    });

    await newLoan.save();

    return res.status(200).send({
      message: "Rollover request submitted. Awaiting admin approval.",
      newLoanId: newLoan._id
    });

  } catch (err) {
    console.error("Rollover error:", err);
    return res.status(500).send("An error occurred while processing rollover.");
  }
});



// ENDS 

// GUARANTOR REQUEST ROUTE 
router.get("/club-de-star-cooperative/guarantorRequest", async (req, res) => {
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
    res.render("dashboard/guarantorRequest", {
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
router.get("/club-de-star-cooperative/profile", async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.redirect("/login");

    const user = await User.findById(req.user._id)
      .populate("account")
      .populate("loans") 
      .populate("referredUsers")
      .exec();

    if (!user) return res.redirect("/login");

    const accountBalance = user.account?.balance || 0;
    const activeLoan = user.loans.find(l => l.status === "active") || null;
    const ROI = user.account?.monthlyROI || 0;
    const totalReferrals = user.referredUsers.length;

        const nigeriaBanks = [
      "Access Bank", "Citibank Nigeria", "Ecobank Nigeria", "Fidelity Bank", 
      "First Bank of Nigeria", "FCMB", "GTB", "Heritage Bank", "Keystone Bank",
      "Providus Bank", "Polaris Bank", "Stanbic IBTC", "Standard Chartered",
      "Sterling Bank", "SunTrust Bank", "Union Bank", "UBA", "Unity Bank",
      "Wema Bank", "Zenith Bank",
      "Opay", "Kuda Bank", "ALAT by Wema", "Rubies Bank", "FairMoney",
      "Carbon", "V Bank", "Aella Credit", "PalmPay", "Paycom", "Chipper Cash", "Flutterwave"
    ];

    res.render("dashboard/profile", {
      user,
      accountBalance,
      loan: activeLoan,
      ROI,
      totalReferrals,
      error: null,
      message: null, 
      success: req.query.success,
      error: req.query.error,
      nigeriaBanks
    });
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).send("Error fetching profile details.");
  }
});
// ENDS 

// REFERRAL ROUTE
router.get("/club-de-star-cooperative/referral", async (req, res) => {
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
    res.render("dashboard/referral", {
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
router.get("/club-de-star-cooperative/memberContract", async (req, res) => {
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
    res.render("dashboard/member-contract", {
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

// Admin dashboard route
router.get("/admin-dashboard", ensureAdmin, async (req, res) => {
  try {
    // Fetch all users with populated fields
    const users = await User.find()
      .populate("Payment")
      .populate("account")
      .populate("loans")
      .populate("referredUsers");

    const admin = req.user;

    // Total Members
    const totalMembers = users.length;

    // New Members This Month
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const newMembersThisMonth = users.filter(u => u.createdAt >= startOfMonth).length;

    // Total Savings (sum of all account balances)
    const accounts = await Account.find();
    const totalSavings = accounts.reduce((sum, acc) => sum + (acc.balance || 0), 0);

    // Active Loans
    const loans = await Loan.find({ status: "active" });
    const totalActiveLoans = loans.reduce((sum, loan) => sum + (loan.amount || 0), 0);
    const activeLoanCount = loans.length;

    // ------------------- Monthly ROI -------------------
    // 1. Sum of member savings for current month
    const monthlySavings = accounts.reduce((sum, acc) => {
      if (acc.createdAt >= startOfMonth) return sum + (acc.balance || 0);
      return sum;
    }, 0);

    // 2. Total savings of all members up to current month
    const totalSavingsAllTime = totalSavings;

    // 3. Interest for the month (sum of all active loan interests)
    const monthlyInterest = loans.reduce((sum, loan) => sum + (loan.interest || 0), 0);

    // 4. Apply ROI formula
    let monthlyROI = 0;
    if (totalSavingsAllTime > 0) {
      monthlyROI = (monthlySavings / totalSavingsAllTime) * monthlyInterest;
      monthlyROI = monthlyROI - monthlyROI * 0.10;
    }

    // Calculate distributed percentage
    let distributedPercentage = 0;
    if (monthlyInterest > 0) {
      distributedPercentage = ((monthlyROI / monthlyInterest) * 100).toFixed(2); // in %
    }

    const recentTransactions = await Transaction.find()
      .populate("user")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    res.render("dashboard/admin/admin", {
      users,
      admin,
      totalMembers,
      newMembersThisMonth,
      totalSavings,
      totalActiveLoans,
      activeLoanCount,
      monthlyROI,
      distributedPercentage,
      recentTransactions
    });
  } catch (err) {
    console.error("Error fetching dashboard data:", err);
    res.status(500).send("Internal Server Error");
  }
});







// Get single member details
router.get('/member/:id', ensureAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate('Payment')
      .populate('account')
      .populate('loans')
      .populate('referredUsers');

    if (!user) return res.status(404).json({ status: false, message: 'User not found' });

    // Convert Windows-style slashes to URL-friendly slashes
    const normalizePath = (filePath) => {
      if (!filePath) return '';
      return filePath.replace(/^public[\\/]/, '').replace(/\\/g, '/'); // Remove 'public\' prefix
    };

    const userData = {
      ...user._doc,
      addressProof: normalizePath(user.addressProof),
      passportPhoto: normalizePath(user.passportPhoto),
      idFile: normalizePath(user.idFile),
      signature: normalizePath(user.signature),
    };

    res.json({ status: true, user: userData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: 'Server error' });
  }
});


// Approve member
router.post('/member/approve/:id', ensureAdmin, async (req, res) => {
  const { accountType } = req.body;

  if (!accountType) {
    return res.status(400).json({ status: false, message: 'Account type is required' });
  }

  try {
    const user = await User.findById(req.params.id).populate('account');
    if (!user) return res.status(404).json({ status: false, message: 'User not found' });

    let baseNumber = 1;
    let unique = false;

    while (!unique) {
      const candidateID = `${accountType}${String(baseNumber).padStart(3, '0')}`;
      const exists = await User.findOne({
        $or: [{ membershipID: candidateID }, { referralCode: candidateID }],
        _id: { $ne: user._id }
      });

      if (exists) {
        baseNumber++;
      } else {
        user.membershipID = candidateID;
        user.referralCode = candidateID;
        unique = true;
      }
    }

    user.status = 'active';
    user.accountType = accountType;
    await user.save();

    let account = user.account;
    if (!account) {
      const interestRate = accountType === 'CD' ? 0.05 : 0.10;
      account = await Account.create({
        user: user._id,
        accountType,
        balance: 0,
        interestRate
      });
      user.account = account._id;
      await user.save();
    } else {
      account.accountType = accountType;
      account.interestRate = accountType === 'CD' ? 0.05 : 0.10;
      await account.save();
    }

    res.json({
      status: true,
      message: `Member approved and set to ${accountType} successfully`,
      membershipID: user.membershipID,
      referralCode: user.referralCode,
      accountID: account._id
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: 'Server error' });
  }
});







module.exports = router;