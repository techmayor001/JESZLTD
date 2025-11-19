const express = require("express"); 
const router = express.Router();
const User = require("../models/User");
const Payment = require("../models/Payment");
const Loan = require("../models/Loan");
const Account = require("../models/Account");
const Transaction = require("../models/Transaction");




router.get('/', (req,res)=>{
    res.render("index")
})

router.get('/gallery', (req,res)=>{
    res.render("gallery")
})

router.get('/about-us', (req,res)=>{
    res.render("about")
})

router.get('/onboard/club-de-star-cooperative', (req,res)=>{
    res.render("auth/auth")
})

// router.get('/club-de-star-cooperative/dashboard', (req,res)=>{
//     res.render("dashboard/user-dashboard")
// })


router.get("/club-de-star-cooperative/dashboard", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    // --- Fetch user with account and loans ---
    const user = await User.findById(req.user._id)
      .populate("loans")
      .populate("account")
      .populate("referredUsers") // populate referrals
      .exec();

    if (!user) return res.redirect("/login");

    // --- Fetch ALL users (for guarantor dropdown) ---
    const users = await User.find({});

    // --- 1. User account balance ---
    const accountBalance = user.account.balance || 0;
    const monthlyROI = user.account.monthlyROI || 0;
    const accumulativeROI = user.account.accumulativeROI || 0;

    // --- 2. Total savings by all members ---
    const allAccounts = await Account.find({});
    const allMembersTotalSavings = allAccounts.reduce(
      (sum, acc) => sum + (acc.balance || 0),
      0
    );

    // --- 3. Sum of all approved loan interests ---
    const allLoans = await Loan.find({ status: "approved" }).populate("user account");
    const totalLoanInterest = allLoans.reduce((sum, loan) => {
      const rate = loan.user.account.accountType === "CD" ? 0.05 : 0.10;
      return sum + loan.amount * rate;
    }, 0);

    // --- 4. Calculate ROI for this user ---
    const ROI = allMembersTotalSavings > 0
      ? (accountBalance / allMembersTotalSavings) * totalLoanInterest * 0.9
      : 0;

    // --- 5. Loan eligibility: months since registration ---
    const today = new Date();
    const monthsSinceJoin = Math.floor((today - user.createdAt) / (1000 * 60 * 60 * 24 * 30));

    // --- 6. Get user's active loan (if any) ---
    const activeLoan = user.loans.find(l => l.status === "active") || null;

    // --- 7. Determine account interest rate for display ---
    const interestRate = user.account.accountType === "CD" ? 5 : 10; // percent

    // --- 8. Referral Program ---
    const referralCode = user.referralCode;
    const referralLink = `${req.protocol}://${req.get("host")}/register?ref=${referralCode}`;
    const totalReferrals = user.referredUsers.length;
    const referralEarning = totalReferrals * 5000; // ₦5,000 per successful referral

    // --- 9. Render dashboard with all data ---
    res.render("dashboard/user-dashboard", {
      user,
      users,
      accountBalance,
      monthlyROI,
      accumulativeROI,
      allMembersTotalSavings,
      totalLoanInterest,
      ROI,
      monthsSinceJoin,
      loan: activeLoan,
      interestRate,

      // Referral data
      referralCode,
      referralLink,
      totalReferrals,
      referralEarning,
      referredUsers: user.referredUsers,
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

// ADMIN DASHBOARD ---------------------TECHMAYOR CO 
router.get("/admin-dashboard", (req,res)=>{
  res.render("dashboard/admin")
})






module.exports = router;