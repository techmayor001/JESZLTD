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

router.get('/onboard/club-de-star-cooperative', (req, res) => {
    const referralCode = req.query.ref || ""; // get referral code from query string
    res.render("auth/auth", { referralCode });
});


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
    const referralLink = `${req.protocol}://${req.get("host")}/onboard/club-de-star-cooperative?ref=${referralCode}`;
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

// Profile route
router.get("/club-de-star-cooperative/profile", async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.redirect("/login");

    // Fetch the logged-in user with account info
    const user = await User.findById(req.user._id)
      .populate("account")  // Include account details
      .populate("loans")    // Include loans if you want active loan info
      .populate("referredUsers") // Include referrals
      .exec();

    if (!user) return res.redirect("/login");

    // Compute dynamic stats for Quick Stats
    const accountBalance = user.account?.balance || 0;
    const activeLoan = user.loans.find(l => l.status === "active") || null;
    const ROI = user.account?.monthlyROI || 0;
    const totalReferrals = user.referredUsers.length;

    res.render("dashboard/profile", {
      user,
      accountBalance,
      loan: activeLoan,
      ROI,
      totalReferrals
    });
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).send("Error fetching profile details.");
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