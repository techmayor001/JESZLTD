const express = require("express");
const router = express.Router();

const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcrypt");
const saltRounds = 10;

const Admin = require("../models/Admin");
const User = require("../models/User");
const Settings = require("../models/Settings");
const MemberType = require("../models/MemberType");
const Account = require("../models/Account");
const Payment = require("../models/Payment");
const Transaction = require("../models/Transaction");
const LoanSettings = require("../models/LoanSettings");
const Loan = require("../models/Loan");
const LoanLedger = require('../models/LoanLedger');
const CompanyROI = require("../models/companyRoiSchema")
const AdminPayment = require("../models/AdminPayment");
const Withdrawal = require("../models/Withdrawal");
const ExtraCharge = require("../models/ExtraCharge");



function ensureAdmin(req, res, next) {
  if (
    req.isAuthenticated() &&
    ["admin", "staff", "superadmin"].includes(req.user.role)
  ) {
    return next();
  }

  return res.redirect(`/admin-login?redirect=${encodeURIComponent(req.originalUrl)}`);
}


// ------------------ ADMIN SIGNUP ------------------
router.get("/admin-signup", async (req, res) => {
  try {
    const superadminExists = await Admin.findOne({ role: "superadmin" });

    if (superadminExists) {
      return res.redirect("/admin-login");
    }

    res.render("auth/admin-auth");
  } catch (error) {
    console.error("Error checking superadmin:", error);
    res.status(500).send("Internal Server Error");
  }
});


// ------------------ ADMIN LOGIN PAGE ------------------
router.get("/admin-login", (req, res) => {
  res.render("auth/admin-login");
});


router.post("/admin-signup", async (req, res) => {
  try {
    const { fullName, email, password, role } = req.body;

    // Validate required fields
    if (!fullName || !email || !password || !role) {
      return res.status(400).json({ status: false, message: "All fields are required." });
    }

    // Validate role
    const validRoles = ["admin", "staff", "superadmin"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ status: false, message: "Invalid role provided." });
    }

    // Check if email already exists
    const existingAdmin = await Admin.findOne({ email: email.toLowerCase() });
    if (existingAdmin) {
      return res.status(400).json({ status: false, message: "Email already registered." });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create admin
    const newAdmin = await Admin.create({
      fullName,
      email: email.toLowerCase(),
      password: hashedPassword,
      role
    });

  return res.redirect("/admin-login");

  } catch (err) {
    console.error("Admin signup error:", err);
    res.status(500).json({ status: false, message: "Internal Server Error" });
  }
});



router.post("/promote-to-superadmin", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ status: false, message: "Email is required." });
    }

    // Check if a super_admin already exists
    const existingSuperAdmin = await User.findOne({ roles: "super_admin" });
    if (existingSuperAdmin) {
      // Redirect to admin login if super_admin exists
      return res.redirect("/admin-login");
    }

    // Find the user to promote
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ status: false, message: "User not found." });
    }

    // Promote user to super_admin if not already
    if (!user.roles.includes("super_admin")) {
      user.roles.push("super_admin");
      await user.save();
    }

    return res.status(200).json({
      status: true,
      message: `${user.firstName} ${user.lastName} has been promoted to Super Admin.`,
      userId: user._id,
    });

  } catch (err) {
    console.error("Super Admin promotion error:", err);
    return res.status(500).json({ status: false, message: "Server error." });
  }
});



router.post("/admin-login", (req, res, next) => {
  passport.authenticate("admin-local", (err, user, info) => {
    if (err) return res.status(500).render("auth/admin-login", { error: "An error occurred" });
    if (!user) return res.status(401).render("auth/admin-login", { error: info?.message });
    
    req.logIn(user, (err) => {
      if (err) return res.status(500).render("auth/admin-login", { error: "Login failed" });
      
      if (["admin", "superadmin"].includes(user.role)) return res.redirect("/admin-dashboard");
      return res.redirect("/onboard/club-de-star-cooperative");
    });
  })(req, res, next);
});



// ------------------ LOGOUT ------------------
router.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error("Logout error:", err);
      return res.redirect("/dashboard?error=logout_failed");
    }
    res.redirect("/admin-login");
  });
});


// ADMIN PAYMENT ROUTES 
router.get("/admin/manage-payment", ensureAdmin, async (req, res) => {
  try {
    const adminPayments = await AdminPayment.find()
      .populate({
        path: "admin",
        select: "fullName email",
      })
      .populate({
        path: "member",
        select: "firstName lastName membershipID email phone account",
        populate: {
          path: "account",
          select: "accountType balance",
          populate: {
            path: "accountType",
            model: "MemberType",
            select: "name",
          },
        },
      })
      .populate({
        path: "loan",
        select: "amount balance duration",
        populate: {
          path: "duration",
          model: "LoanSettings",
        },
      })
      .sort({ createdAt: -1 });

    res.render("dashboard/admin/payment", {
      admin: req.user,
      adminPayments,
    });

  } catch (error) {
    console.error("Error fetching admin direct payments:", error);
    res.status(500).send("Internal Server Error");
  }
});

router.get("/admin/search-member", ensureAdmin, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);

    // Find users matching the search query
    const users = await User.find({
      $or: [
        { membershipID: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
        { firstName: { $regex: q, $options: "i" } },
        { lastName: { $regex: q, $options: "i" } }
      ]
    })
      .populate("account") // populate balance
      .limit(5);

    // Populate loans for each user
    const results = await Promise.all(
      users.map(async (u) => {
        const loans = await Loan.find({
          user: u._id,
          status: { $in: ["approved"] }, // only approved loans
        })
          .select("amount totalRepay status dueDate createdAt")
          .populate({
            path: "duration",
            select: "name months", // assuming LoanSettings has name and months
          });

        return {
          id: u._id,
          name: `${u.firstName} ${u.lastName}`,
          membershipID: u.membershipID,
          email: u.email,
          balance: u.account?.balance || 0,
          loans: loans.map((loan) => ({
            id: loan._id,
            originalAmount: loan.amount,
            totalRepay: loan.totalRepay,
            balanceRemaining: loan.totalRepay, // you can calculate repayments if needed
            dueDate: loan.dueDate,
            duration: loan.duration?.name || "N/A",
            months: loan.duration?.months || 0,
          })),
        };
      })
    );

    res.json(results);
  } catch (err) {
    console.error("Search member error:", err);
    res.status(500).json([]);
  }
});


router.post("/admin/confirm-payment", ensureAdmin, async (req, res) => {
  try {
    const {
      memberId,
      paymentType,
      amount,
      chargeAmount = 0,
      paymentMethod,
      reference,
      notes,
      loanId,
      chargeType,
    } = req.body;

    if (!memberId || !paymentType || !amount || !paymentMethod) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const member = await User.findById(memberId).populate("account");
    if (!member || !member.account) {
      return res.status(404).json({ message: "Member account not found" });
    }

    const balanceBefore = member.account.balance;
    let balanceAfter = balanceBefore;
    const totalAmount = Number(amount) + Number(chargeAmount);

    switch (paymentType) {
      case "deposit":
        balanceAfter += totalAmount;
        break;

      case "withdrawal":
      case "direct-debit":
        if (balanceBefore < totalAmount) {
          return res.status(400).json({ message: "Insufficient balance" });
        }
        balanceAfter -= totalAmount;
        break;

      case "loan-repayment":
        break;

      default:
        return res.status(400).json({ message: "Invalid payment type" });
    }

    member.account.balance = balanceAfter;
    await member.account.save();

    // ✅ LOGGED-IN ADMIN
    const loggedInAdmin = req.user; // Admin model

    const adminPayment = await AdminPayment.create({
      admin: loggedInAdmin._id, // ✅ Admin reference
      member: member._id,
      paymentType,
      amount,
      chargeAmount,
      totalAmount,
      loan: loanId || null,
      chargeType: chargeType || null,
      paymentMethod,
      reference,
      notes,
      balanceBefore,
      balanceAfter,
      status: "successful",
    });

    let transactionType = paymentType;
    if (paymentType === "loan-repayment") transactionType = "loan_payment";
    if (paymentType === "direct-debit") transactionType = "withdrawal";

    await Transaction.create({
      user: member._id,
      type: transactionType,
      amount: totalAmount,
      status: "successful",
      description: notes || `Admin ${paymentType.replace("-", " ")}`,
      reference: reference || adminPayment._id.toString(),
      method: paymentMethod,
    });

    res.json({
      success: true,
      transaction: {
        id: adminPayment._id,
        reference: reference || adminPayment._id,
        date: adminPayment.createdAt,
        type: paymentType,
        amount,
        chargeAmount,
        totalAmount,
        balanceBefore,
        balanceAfter,
        paymentMethod,
        notes,
        member: {
          name: `${member.firstName} ${member.lastName}`,
          membershipID: member.membershipID,
          email: member.email,
          phone: member.phone,
        },
        processedBy: loggedInAdmin.fullName, // ✅ FIXED
        adminEmail: loggedInAdmin.email,
      },
    });

  } catch (err) {
    console.error("Confirm payment error:", err);
    res.status(500).json({ message: "Payment processing failed" });
  }
});





router.get("/admin/manage-payments", ensureAdmin, async (req, res) => {
  try {
    const payments = await Payment.find()
      .populate({
        path: "user",
        select: "firstName lastName membershipID email phone account",
        populate: {
          path: "account",
          select: "accountType",
          populate: {
            path: "accountType",
            model: "MemberType",
            select: "name",
          },
        },
      })
      .populate({
        path: "loanId",
        populate: {
          path: "duration",
          model: "LoanSettings",
        },
      })
      .sort({ createdAt: -1 });

    const transactions = await Transaction.find()
      .populate({
        path: "user",
        select: "firstName lastName membershipID email phone",
      })
      .sort({ createdAt: -1 });

    res.render("dashboard/admin/payment", {
      admin: req.user,
      payments,
      transactions, // ✅ now available in the view
    });
  } catch (error) {
    console.error("Error fetching payments & transactions:", error);
    res.status(500).send("Internal Server Error");
  }
});


// DEPOSITS ROUTE STARTS HERE 
router.get("/admin/manage-deposits", ensureAdmin, async (req, res) => {
  try {
    const payments = await Payment.find()
      .populate({
        path: "user",
        select: "firstName lastName membershipID email account",
        populate: {
          path: "account",
          select: "balance",
        },
      })
      .sort({ createdAt: -1 });

    // 🔄 Transform to frontend format
const deposits = payments.map((payment) => {
  const dateObj = new Date(payment.createdAt);

  // Full member name
  const memberFullName = payment.user
    ? `${payment.user.firstName} ${payment.user.lastName}`
    : "N/A";

return {
  id: payment._id,
  reference: payment.reference,

  date: dateObj.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }),

  time: dateObj.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }),

  memberName: memberFullName,
  payeeName: payment.payeeName,

  memberId: payment.user?.membershipID || "N/A",
  email: payment.email,

  // ✅ FIX HERE
  amount: payment.amount / 100,

  method: payment.paystackResponse?.channel || "Bank Transfer",

  status:
    payment.status === "paid" || payment.status === "success"
      ? "approved"
      : payment.status === "failed"
      ? "rejected"
      : "pending",

  // ⚠️ Make sure balance is also in naira
  balance: (payment.user?.account?.balance || 0) / 100,

  notes: payment.paystackResponse?.message || "Deposit payment",
};

});

// 📊 Stats calculations
const totalIncome = payments
  .filter(p => p.status === "paid" || p.status === "success")
  .reduce((sum, p) => sum + p.amount, 0);

const pendingCount = payments.filter(p => p.status === "pending").length;

// Approved today
const today = new Date();
today.setHours(0, 0, 0, 0);

const approvedToday = payments.filter(p => {
  const created = new Date(p.createdAt);
  return (
    (p.status === "paid" || p.status === "success") &&
    created >= today
  );
}).length;

// Active members (unique users with at least one deposit)
const activeMembers = new Set(
  payments
    .filter(p => p.user)
    .map(p => p.user._id.toString())
).size;


    res.render("dashboard/admin/deposits", {
      admin: req.user,
      deposits,
      stats: {
        totalIncome,
        pendingCount,
        approvedToday,
        activeMembers
      }
    });

  } catch (error) {
    console.error("Error fetching deposits:", error);
    res.status(500).send("Internal Server Error");
  }
});

router.post(
  "/admin/deposits/:id/approve",
  ensureAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { notes } = req.body;

      const payment = await Payment.findById(id).populate({
        path: "user",
        populate: { path: "account" },
      });

      if (!payment) {
        return res.status(404).json({ message: "Deposit not found" });
      }

      // ❌ Prevent double approval
      if (payment.status === "success" || payment.status === "paid") {
        return res.status(400).json({ message: "Deposit already approved" });
      }

      // ✅ Update payment
      payment.status = "success";
      payment.paystackResponse = {
        ...(payment.paystackResponse || {}),
        adminNote: notes || "Approved by admin",
        approvedAt: new Date(),
      };

      // ✅ Credit user account
      if (payment.user && payment.user.account) {
        payment.user.account.balance += payment.amount;
        await payment.user.account.save();
      }

      // ✅ Update linked transaction
      const transaction = await Transaction.findOne({
        user: payment.user?._id,
        reference: payment.reference,
        type: "deposit",
      });

      if (transaction) {
        transaction.status = "successful";
        transaction.method =
          payment.paystackResponse?.channel || "Bank Transfer";

        transaction.description =
          transaction.description ||
          `Deposit approved by admin (${payment.reference})`;

        await transaction.save();
      }

      await payment.save();

      res.json({
        success: true,
        message: "Deposit approved and transaction recorded",
        newBalance: payment.user?.account?.balance || 0,
      });

    } catch (error) {
      console.error("Approve deposit error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);


router.post(
  "/admin/deposits/:id/reject",
  ensureAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      if (!reason || !reason.trim()) {
        return res.status(400).json({
          message: "Rejection reason is required",
        });
      }

      const payment = await Payment.findById(id).populate("user");

      if (!payment) {
        return res.status(404).json({ message: "Deposit not found" });
      }

      // ❌ Prevent rejecting an already approved deposit
      if (payment.status === "success" || payment.status === "paid") {
        return res.status(400).json({
          message: "Approved deposits cannot be rejected",
        });
      }

      // ✅ Update payment
      payment.status = "failed";
      payment.paystackResponse = {
        ...(payment.paystackResponse || {}),
        adminNote: reason,
        rejectedAt: new Date(),
      };

      // ✅ Update linked transaction
      const transaction = await Transaction.findOne({
        user: payment.user?._id,
        reference: payment.reference,
        type: "deposit",
      });

      if (transaction) {
        transaction.status = "failed";
        transaction.method =
          payment.paystackResponse?.channel || "Bank Transfer";

        transaction.description =
          transaction.description ||
          `Deposit rejected by admin (${payment.reference})`;

        await transaction.save();
      }

      await payment.save();

      res.json({
        success: true,
        message: "Deposit rejected and transaction updated",
      });

    } catch (error) {
      console.error("Reject deposit error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);



// ADMIN WITHDRWALS MANAGEMENT 
router.get("/admin/manage-withdrawals", ensureAdmin, async (req, res) => {
  try {
    const withdrawals = await Withdrawal.find()
      .populate({
        path: "user",
        select: "firstName lastName membershipID email phone account",
        populate: {
          path: "account",
          select: "balance",
        },
      })
      .sort({ createdAt: -1 });

    // Transform data for frontend
    const withdrawalData = withdrawals.map((withdrawal) => {
      const dateObj = new Date(withdrawal.createdAt);

      const memberFullName = withdrawal.user
        ? `${withdrawal.user.firstName} ${withdrawal.user.lastName}`
        : "N/A";

      return {
        id: withdrawal._id,
        reference: withdrawal.reference,
        date: dateObj.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        time: dateObj.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        memberName: memberFullName,
        memberId: withdrawal.user?.membershipID || "N/A",
        memberEmail: withdrawal.user?.email || "N/A",
        memberPhone: withdrawal.user?.phone || "N/A",
        amount: withdrawal.amount,
        bankName: withdrawal.bankName,
        accountName: withdrawal.accountName,
        accountNumber: withdrawal.accountNumber,
        method: "Bank Transfer",
        type: withdrawal.type || "normal", // ✅ include withdrawal type
        status:
          withdrawal.status === "success"
            ? "approved"
            : withdrawal.status === "failed"
            ? "rejected"
            : withdrawal.status === "processing"
            ? "processing"
            : "pending",
        balance: withdrawal.user?.account?.balance || 0,
        notes: withdrawal.providerResponse?.message || "Withdrawal request",
      };
    });

    // Stats
    const pendingRequests = withdrawals.filter(
      (w) => w.status === "pending" || w.status === "processing"
    ).length;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const approvedToday = withdrawals.filter(
      (w) => w.status === "success" && new Date(w.createdAt) >= today
    ).length;

    const rejectedToday = withdrawals.filter(
      (w) => w.status === "failed" && new Date(w.createdAt) >= today
    ).length;

    const totalAmount = withdrawals
      .filter((w) => w.status === "success")
      .reduce((sum, w) => sum + w.amount, 0);

    res.render("dashboard/admin/withdrawal", {
      admin: req.user,
      withdrawals: withdrawalData,
      stats: { pendingRequests, approvedToday, rejectedToday, totalAmount },
    });
  } catch (error) {
    console.error("Error fetching withdrawals:", error);
    res.status(500).send("Internal Server Error");
  }
});


router.post("/admin/withdrawals/:id/approve", ensureAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { notes } = req.body;

        const withdrawal = await Withdrawal.findById(id)
            .populate({ path: "user", populate: { path: "account" } });

        if (!withdrawal) return res.status(404).json({ message: "Withdrawal not found" });

        if (withdrawal.status === "success") {
            return res.status(400).json({ message: "Withdrawal already approved" });
        }

        const settings = await Settings.getSettings();

        let chargeAmount = 0;
        let userDeduction = withdrawal.amount;

        // Forceful withdrawal logic
        if (withdrawal.type === "forceful") {
            // Charge % from settings
            const forceChargeRate = settings.otherFees.forceWithdrawalCharge || 2.5; // %
            chargeAmount = (forceChargeRate / 100) * withdrawal.amount;

            // Deduct 50% of withdrawal + charge
            userDeduction = withdrawal.amount * 0.5 + chargeAmount;

            // Create extra charge record for company
            await ExtraCharge.create({
                member: withdrawal.user._id,
                chargeType: "forceful-withdrawal",
                amount: chargeAmount,
                reason: "Forceful withdrawal charge",
            });

            // Reduce the withdrawal amount by what was already paid
            withdrawal.amount -= userDeduction;

            withdrawal.status = "pending"; // keep pending
            withdrawal.amountPaid = (withdrawal.amountPaid || 0) + userDeduction; // track total paid so far
        } else {
            // Normal withdrawal, approve fully
            withdrawal.status = "success";
        }

        // Deduct from user balance
        if (withdrawal.user && withdrawal.user.account) {
            withdrawal.user.account.balance -= userDeduction;
            await withdrawal.user.account.save();
        }

        // Record transaction — always successful
        await Transaction.create({
            user: withdrawal.user._id,
            type: "withdrawal",
            reference: withdrawal.reference,
            amount: userDeduction,
            status: "successful", // ✅ always successful for partial approve
            method: withdrawal.method || "Bank Transfer",
            description: withdrawal.type === "forceful"
                ? `Partial withdrawal for forceful type with charge ${chargeAmount}`
                : "Withdrawal approved by admin",
        });

        withdrawal.notes = notes || "Approved by admin";
        await withdrawal.save();

        res.json({
            success: true,
            message: withdrawal.type === "forceful"
                ? "Forceful withdrawal partially processed and pending"
                : "Withdrawal approved successfully",
            newBalance: withdrawal.user.account.balance,
            status: withdrawal.status,
            remainingAmount: withdrawal.amount // send remaining amount back to frontend
        });

    } catch (error) {
        console.error("Approve withdrawal error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});


// EXTRA CHARGES SECTION
router.get("/admin/manage-extra-charges", ensureAdmin, async (req, res) => {
  try {
    const charges = await ExtraCharge.find()
      .populate({
        path: "member",
        select: "firstName lastName membershipID email phone",
      })
      .populate({
        path: "relatedLoan",
        select: "loanNumber amount status",
      })
      .sort({ createdAt: -1 });

    // 🔄 Transform data for frontend
    const chargeData = charges.map((charge) => {
      const appliedDate = new Date(charge.appliedAt);
      const paidDate = charge.paidAt ? new Date(charge.paidAt) : null;

      const memberFullName = charge.member
        ? `${charge.member.firstName} ${charge.member.lastName}`
        : "N/A";

      return {
        id: charge._id,
        memberId: charge.member?.membershipID || "N/A",
        memberName: memberFullName,
        memberEmail: charge.member?.email || "N/A",
        memberPhone: charge.member?.phone || "N/A",
        chargeType: charge.chargeType,
        amount: charge.amount,
        status: charge.status,
        reason: charge.reason || "—",
        appliedAt: appliedDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        paidAt: paidDate
          ? paidDate.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : null,
        relatedLoan: charge.relatedLoan
          ? {
              id: charge.relatedLoan._id,
              loanNumber: charge.relatedLoan.loanNumber,
              amount: charge.relatedLoan.amount,
              status: charge.relatedLoan.status,
            }
          : null,
      };
    });

    // 📊 Stats
    const totalCollected = charges
      .filter((c) => c.status === "paid")
      .reduce((sum, c) => sum + c.amount, 0);

    const pendingAmount = charges
      .filter((c) => c.status === "pending")
      .reduce((sum, c) => sum + c.amount, 0);

    const waivedCount = charges.filter(
      (c) => c.status === "waived"
    ).length;

    res.render("dashboard/admin/extraCharges", {
      admin: req.user,
      charges: chargeData,
      stats: {
        totalCollected,
        pendingAmount,
        waivedCount,
        totalCharges: charges.length,
      },
    });
  } catch (error) {
    console.error("Error fetching extra charges:", error);
    res.status(500).send("Internal Server Error");
  }
});
// ADMINS CONFIG 

// MEMBER TYPE 
router.get("/admin/manage/memberType", ensureAdmin, async (req, res) => {
  try {
    const memberTypes = await MemberType.find().sort({ name: 1 }).lean();

    // Count members for each type
    const users = await User.find({}, "account membershipID").lean();

    memberTypes.forEach(type => {
      type.members = users.filter(u => u.membershipID?.startsWith(type.shortCode)).length;
    });

    res.render("dashboard/admin/member-type", {
      admin: req.user,
      memberTypes
    });
  } catch (error) {
    console.error("Error fetching member types:", error);
    res.status(500).send("Internal Server Error");
  }
});

// CREATE or UPDATE Member Type
router.post("/admin/manage/memberType", ensureAdmin, async (req, res) => {
  try {
    const { id, name, shortCode, interestRate, isDefault } = req.body;

    if (!shortCode || shortCode.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Shortcode is required",
      });
    }

    // If this member type is being set as default → unset previous default(s)
    if (isDefault) {
      await MemberType.updateMany(
        { isDefault: true },
        { isDefault: false }
      );
    }

    // UPDATE existing MemberType
    if (id) {
      const existingType = await MemberType.findById(id);
      if (!existingType) {
        return res.json({
          success: false,
          message: "Membership type not found",
        });
      }

      const oldShortCode = existingType.shortCode?.trim() || "";
      const newShortCode = shortCode.trim();

      // Update the MemberType document
      const updated = await MemberType.findByIdAndUpdate(
        id,
        { name, shortCode: newShortCode, interestRate, isDefault },
        { new: true }
      );

      // 🔥 If shortcode first letter changed → update all users
      if (oldShortCode.charAt(0) !== newShortCode.charAt(0)) {
        const newChar = newShortCode.charAt(0);
        const users = await User.find({});

        let updatedCount = 0;

        for (const user of users) {
          if (!user.membershipID) continue;

          // Replace only the first character
          const newMembershipID = newChar + user.membershipID.substring(1);

          if (user.membershipID !== newMembershipID) {
            user.membershipID = newMembershipID;
            user.referralCode = newMembershipID;
            await user.save();
            updatedCount++;
          }
        }

        console.log(`Users updated: ${updatedCount}`);
      }

      return res.json({
        success: true,
        message: "Membership type updated successfully",
        updated,
      });
    }

    // CREATE new MemberType
    const newType = new MemberType({
      name,
      shortCode: shortCode.trim(),
      interestRate,
      isDefault,
    });

    // If it is set as default, ensure others are unset (already done above)
    await newType.save();

    return res.json({
      success: true,
      message: "Membership type created successfully",
      newType,
    });
  } catch (error) {
    console.error("Error saving member type:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});



// DELETE Member Type
router.delete("/admin/manage/memberType/:id", ensureAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await MemberType.findByIdAndDelete(id);

    if (!deleted) {
      return res.json({ success: false, message: "Membership type not found" });
    }

    return res.json({ success: true, message: "Membership type deleted" });

  } catch (error) {
    console.error("Error deleting member type:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});


// GET: Manage Members Page
router.get('/admin-dashboard', ensureAdmin, async (req, res) => {
    try {
        // Fetch all users + their accounts + membership type inside account
        const users = await User.find()
            .populate({
                path: "account",
                populate: {
                    path: "accountType", // MemberType reference
                }
            });

        // Fetch all membership types
        const memberTypes = await MemberType.find();

        res.render('dashboard/admin/members', {
            admin: req.user,
            users,
            memberTypes
        });

    } catch (err) {
        console.error("Error loading members:", err);
        res.status(500).send("Server error loading members");
    }
});

router.post('/admin/members/approve/:id', ensureAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        const { memberTypeId } = req.body;

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        const type = await MemberType.findById(memberTypeId);
        if (!type) return res.status(404).json({ message: "Member type not found" });

        // Find the last membership ID for this type
        const lastUser = await User.findOne({ membershipID: { $regex: `^${type.shortCode}` } })
                                   .sort({ membershipID: -1 })
                                   .lean();

        let nextNumber = 1;

        if (lastUser && lastUser.membershipID) {
            const lastNumberStr = lastUser.membershipID.replace(type.shortCode, '');
            const lastNumber = parseInt(lastNumberStr, 10);
            if (!isNaN(lastNumber)) {
                nextNumber = lastNumber + 1;
            }
        }

        // Generate sequential Membership ID
        const membershipID = `${type.shortCode}${String(nextNumber).padStart(3, '0')}`;

        // Update user
        user.status = "active";
        user.membershipID = membershipID;
        await user.save();

        // Update or create account
        let account = await Account.findOne({ user: user._id });
        if (!account) {
            account = new Account({
                user: user._id,
                accountType: type._id
            });
        } else {
            account.accountType = type._id;
        }
        await account.save();

        // Return to frontend
        res.json({
            message: "Member approved successfully",
            membershipID,
            memberTypeName: type.name,
            email: user.email
        });

    } catch (err) {
        console.error("Approve member error:", err);
        res.status(500).json({ message: "Internal server error" });
    }
});

router.post('/admin/members/delete/:id', ensureAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    // Find user
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ status: false, message: 'User not found' });

    // Delete related account
    if (user.account) {
      await Account.findByIdAndDelete(user.account);
    }

    // Delete related payment records
    if (user.Payment) {
      await Payment.findByIdAndDelete(user.Payment);
    }

    // Optionally, remove references from other users' referrals
    await User.updateMany(
      { referredUsers: user._id },
      { $pull: { referredUsers: user._id } }
    );

    // Delete the user
    await User.findByIdAndDelete(userId);

    res.json({ status: true, message: 'Member deleted successfully' });
  } catch (err) {
    console.error('Delete member error:', err);
    res.status(500).json({ status: false, message: 'Internal server error' });
  }
});

// Delete member and all associated data
router.post("/members/delete/:id", async (req, res) => {
    try {
        const memberId = req.params.id;

        const user = await User.findById(memberId);
        if (!user) {
            return res.status(404).json({ status: false, message: "Member not found" });
        }

        // Delete Account
        if (user.account) {
            await Account.findByIdAndDelete(user.account);
        }

        // Delete Loans
        if (user.loans && user.loans.length > 0) {
            await Loan.deleteMany({ _id: { $in: user.loans } });
        }

        // Delete Payments
        if (user.Payment) {
            await Payment.findByIdAndDelete(user.Payment);
        }

        // Delete Transactions
        await Transaction.deleteMany({ user: memberId });

        // Remove member from referredUsers of other users
        await User.updateMany(
            { referredUsers: memberId },
            { $pull: { referredUsers: memberId } }
        );

        // Delete Guarantor Requests associated with this user
        await User.updateMany(
            { "guarantorRequests.borrower": memberId },
            { $pull: { guarantorRequests: { borrower: memberId } } }
        );

        // Finally, delete the user
        await User.findByIdAndDelete(memberId);

        res.json({ status: true, message: "Member and all associated data deleted successfully" });
    } catch (err) {
        console.error("Error deleting member:", err);
        res.status(500).json({ status: false, message: "Error deleting member" });
    }
});



// LOAN MANAGEMENT 
router.get("/admin/manage-loan", ensureAdmin, async (req, res) => {
  try {
    const loans = await Loan.find()
      .populate({
        path: "user",
        select: "firstName lastName membershipID email phone account", // <-- added email and phone
        populate: {
          path: "account",
          select: "accountType",
          populate: {
            path: "accountType",
            model: "MemberType",
            select: "name"
          }
        }
      })
      .populate("duration") // LoanSettings
      .populate({
        path: "guarantors.guarantor",
        select: "firstName lastName membershipID email phone account" // <-- added email and phone for guarantors
      })
      .sort({ createdAt: -1 });

    res.render("dashboard/admin/loan", { admin: req.user, loans });

  } catch (error) {
    console.error("Error fetching loans:", error);
    res.status(500).send("Internal Server Error");
  }
});

router.get("/admin/external-loans", ensureAdmin, async (req, res) => {
  try {
    const loans = await Loan.find()
      .populate({
        path: "user",
        select: "firstName lastName membershipID email phone account",
        populate: {
          path: "account",
          select: "accountType",
          populate: {
            path: "accountType",
            model: "MemberType",
            select: "name"
          }
        }
      })
      // Populate admin who initiated the loan
      .populate({
        path: "initiatedBy",
        select: "fullName email role"
      })
      .populate("duration")
      .populate({
        path: "guarantors.guarantor",
        select: "firstName lastName membershipID email phone"
      })
      .sort({ createdAt: -1 });

    const users = await User.find().select(
      "firstName lastName membershipID email phone"
    );

    res.render("dashboard/admin/external-loans", {
      admin: req.user,
      loans,
      users
    });

  } catch (error) {
    console.error("Error fetching external loans:", error);
    res.status(500).send("Internal Server Error");
  }
});


router.post("/api/loans/approve", ensureAdmin, async (req, res) => {
  try {
    const { loanId, disbursementMethod, disbursementDate } = req.body;

    if (!loanId || !disbursementMethod || !disbursementDate) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    const approvedBy = req.user?._id;
    if (!approvedBy) return res.status(401).json({ message: "Unauthorized." });

    const loan = await Loan.findById(loanId)
      .populate("duration")
      .populate("user")
      .populate("guarantors.guarantor");

    if (!loan) return res.status(404).json({ message: "Loan not found." });

    // --------------------------
    // Check if all guarantors accepted
    // --------------------------
    const allGuarantorsAccepted = loan.guarantors.every(
      g => g.status === "accepted"
    );

    if (!allGuarantorsAccepted) {
      return res.status(400).json({ message: "All guarantors must accept." });
    }

    // --------------------------
    // Determine duration
    // --------------------------
    const durationMonths = loan.user ? loan.duration?.duration : loan.externalDuration;

    if (!durationMonths) return res.status(400).json({ message: "Loan duration missing." });

    // --------------------------
    // Remove existing loans for internal users
    // --------------------------
    if (loan.user) {
      const existingLoan = await Loan.findOne({
        user: loan.user._id,
        _id: { $ne: loan._id },
        status: { $in: ["pending", "approved"] }
      });
      if (existingLoan) await Loan.deleteOne({ _id: existingLoan._id });
    }

    // --------------------------
    // Approve loan
    // --------------------------
    const disburseDate = new Date(disbursementDate);
    const dueDate = new Date(disburseDate);
    dueDate.setMonth(dueDate.getMonth() + durationMonths);

    loan.status = "approved";
    loan.disbursementMethod = disbursementMethod;
    loan.disbursementDate = disburseDate;
    loan.dueDate = dueDate;
    loan.approvedAt = new Date();
    await loan.save();

    // --------------------------
    // Ledger entry
    // --------------------------
    const ledgerData = {
      loan: loan._id,
      approvedBy,
      amount: loan.amount,
      interestRate: loan.interestRate,
      durationMonths,
      disbursementMethod,
      disbursementDate: disburseDate,
      dueDate,
      approvedAt: new Date(),
      status: "approved"
    };

    // Only set member if internal
    if (loan.user) ledgerData.member = loan.user._id;
    // Only set externalBorrower if external
    if (!loan.user) ledgerData.externalBorrower = loan.external;

    const ledgerEntry = await LoanLedger.create(ledgerData);

    // --------------------------
    // Update guarantor stats
    // --------------------------
    for (const g of loan.guarantors) {
      const guarantor = await User.findById(g.guarantor._id);
      if (!guarantor) continue;

      guarantor.guarantorRequestStats.totalReceived += 1;

      if (g.status === "accepted") {
        guarantor.guarantorRequestStats.totalAccepted += 1;
        guarantor.guarantorRequestStats.totalAmountApproved += loan.amount;
      } else {
        guarantor.guarantorRequestStats.totalDeclined += 1;
      }

      await guarantor.save();
    }

    // --------------------------
    // Company ROI
    // --------------------------
    const currentMonth = new Date().toISOString().slice(0, 7);
    const interestForLoan = loan.amount * (loan.interestRate / 100) * durationMonths;

    let companyRoi = await CompanyROI.findOne({ month: currentMonth });

    if (!companyRoi) {
      companyRoi = await CompanyROI.create({
        month: currentMonth,
        totalInterestCollected: interestForLoan,
        companyCharge: interestForLoan * 0.1,
        netInterestForRoi: interestForLoan * 0.9,
        totalRoiDistributed: 0,
        status: "open"
      });
    } else if (companyRoi.status === "open") {
      companyRoi.totalInterestCollected += interestForLoan;
      companyRoi.companyCharge = companyRoi.totalInterestCollected * 0.1;
      companyRoi.netInterestForRoi = companyRoi.totalInterestCollected - companyRoi.companyCharge;
      await companyRoi.save();
    }

    // --------------------------
    // Response
    // --------------------------
    const borrowerName = loan.user
      ? `${loan.user.firstName} ${loan.user.lastName}`
      : loan.external?.borrowerName || "Company";

    return res.status(200).json({
      message: `Loan for ${borrowerName} approved successfully.`,
      loan,
      ledger: ledgerEntry,
      companyRoi
    });

  } catch (error) {
    console.error("Error approving loan:", error);
    return res.status(500).json({ message: "Server error while approving loan." });
  }
});



router.post("/api/loans/reject", ensureAdmin, async (req, res) => {
  try {
    const { loanId, reason, details } = req.body;
    if (!loanId || !reason || !details) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    const rejectedBy = req.user?._id;
    if (!rejectedBy) return res.status(401).json({ message: "Unauthorized." });

    const loan = await Loan.findById(loanId)
      .populate("duration")
      .populate("user")
      .populate("guarantors.guarantor");

    if (!loan) return res.status(404).json({ message: "Loan not found." });

    // --- Mark loan as rejected ---
    loan.status = "rejected";
    loan.rejectedAt = new Date();
    loan.rejectionReason = reason;
    loan.rejectionDetails = details;
    await loan.save();

    // --- Remove any other pending/active loans for the user ---
    const otherLoans = await Loan.find({
      user: loan.user._id,
      _id: { $ne: loan._id },
      status: { $in: ["pending", "approved"] }
    });

    for (const l of otherLoans) {
      await Loan.deleteOne({ _id: l._id });
    }

    // --- Update guarantor stats ---
    for (const g of loan.guarantors) {
      const guarantorUser = await User.findById(g.guarantor._id);
      if (!guarantorUser) continue;

      guarantorUser.guarantorRequestStats.totalReceived += 1;

      if (g.status === "accepted") {
        guarantorUser.guarantorRequestStats.totalDeclined += 1;
      } else {
        guarantorUser.guarantorRequestStats.totalDeclined += 1;
      }

      await guarantorUser.save();
    }

    // --- Create declined transaction for user ---
    await Transaction.create({
      user: loan.user._id,
      type: "loan_payment",
      amount: loan.amount,
      status: "declined",
      description: `Loan rejected: ${reason}`,
      reference: `REJECT-${loan._id}`,
      method: "loan_application"
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



router.post("/admin/external-loans", ensureAdmin, async (req, res) => {
  try {
    const {
      borrowerName,
      borrowerPhone,
      borrowerEmail,
      borrowerType,
      borrowerAddress,
      loanAmount,
      interestRate,
      loanDuration, // months
      dueDate,
      loanPurpose,
      guarantor1,
      guarantor2
    } = req.body;

    // ----------------------
    // Validation
    // ----------------------
    if (
      !borrowerName ||
      !borrowerPhone ||
      !borrowerType ||
      !loanAmount ||
      !interestRate ||
      !loanDuration ||
      !dueDate
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!guarantor1 || !guarantor2) {
      return res.status(400).json({ error: "Both guarantors are required" });
    }

    if (guarantor1 === guarantor2) {
      return res.status(400).json({ error: "Guarantors cannot be the same person" });
    }

    // ----------------------
    // Calculate total repayment (MONTHLY simple interest)
    // Formula:
    // Interest = Amount × (Rate / 100) × Months
    // ----------------------
    const amount = parseFloat(loanAmount);
    const rate = parseFloat(interestRate);
    const duration = parseInt(loanDuration, 10);

    const interest = amount * (rate / 100) * duration;
    const totalRepay = amount + interest;

    // ----------------------
    // Prepare guarantors array
    // ----------------------
    const guarantorsArray = [
      { guarantor: guarantor1 },
      { guarantor: guarantor2 }
    ];

    // ----------------------
    // Create the loan (status: pending)
    // ----------------------
    const newLoan = new Loan({
      external: {
        borrowerType,
        borrowerName,
        email: borrowerEmail,
        phone: borrowerPhone,
        address: borrowerAddress
      },
      initiatedBy: req.user._id, // admin issuing loan
      amount,
      totalRepay,
      interestRate: rate, // monthly %
      externalDuration: duration, // months
      dueDate,
      guarantors: guarantorsArray,
      status: "pending",
      purpose: loanPurpose
    });

    await newLoan.save();

    // ----------------------
    // Create guarantor requests
    // ----------------------
    await Promise.all(
      [guarantor1, guarantor2].map(async (gid) => {
        const gUser = await User.findById(gid);
        if (!gUser) return;

        gUser.guarantorRequests.push({
          borrower: req.user._id, // admin as borrower
          loan: newLoan._id,
          amount,
          status: "pending"
        });

        gUser.guarantorRequestStats.totalReceived += 1;
        await gUser.save();
      })
    );

    // ----------------------
    // Response
    // ----------------------
    res.status(201).json({
      message: "External loan issued successfully. Awaiting guarantor approval.",
      loan: newLoan
    });

  } catch (error) {
    console.error("Error issuing external loan:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});



router.get("/admin/loan/settings", ensureAdmin, async (req, res) => {
  try {
    const loanSettings = await LoanSettings.find().sort({ loanName: 1 });

    res.render("dashboard/admin/loan-settings", {
      admin: req.user,
      loanSettings
    });

  } catch (error) {
    console.error("Error fetching loan settings:", error);
    res.status(500).send("Internal Server Error");
  }
});

router.post("/api/loan/settings/add", ensureAdmin, async (req, res) => {
  try {
    const {
      id, // This will be used for editing
      loanName,
      duration,
      penaltyPercentage,
      rolloverPercentage,
      eligibilityUnit,
      eligibilityValue,
      status
    } = req.body;

    // If ID exists → UPDATE
    if (id) {
      const updated = await LoanSettings.findByIdAndUpdate(
        id,
        {
          loanName,
          duration,
          penaltyPercentage,
          rolloverPercentage,
          eligibilityUnit,
          eligibilityValue,
          status: status === "active" ? "active" : "inactive",
          updatedAt: Date.now()
        },
        { new: true }
      );

      if (!updated) {
        return res.json({ status: false, message: "Loan setting not found" });
      }

      return res.json({ status: true, message: "Loan setting updated successfully", updated });
    }

    // If NO ID → CREATE NEW
    const newSetting = new LoanSettings({
      loanName,
      duration,
      penaltyPercentage,
      rolloverPercentage,
      eligibilityUnit,
      eligibilityValue,
      status: status === "active" ? "active" : "inactive",
      updatedAt: Date.now()
    });

    await newSetting.save();

    return res.json({ status: true, message: "Loan setting added successfully", newSetting });

  } catch (error) {
    console.error("Error saving loan setting:", error);
    return res.json({ status: false, message: "Failed to save loan setting" });
  }
});

router.post("/api/loan/settings/toggle", ensureAdmin, async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) return res.json({ status: false, message: "Missing setting ID" });

    const setting = await LoanSettings.findById(id);
    if (!setting) return res.json({ status: false, message: "Setting not found" });

    // Toggle status
    setting.status = setting.status === "active" ? "inactive" : "active";
    setting.updatedAt = Date.now();

    await setting.save();

    return res.json({
      status: true,
      message: `Setting ${setting.status === "active" ? "activated" : "deactivated"} successfully`,
      newStatus: setting.status
    });

  } catch (error) {
    console.error("Toggle setting error:", error);
    return res.json({ status: false, message: "Failed to toggle setting" });
  }
});

router.post("/api/loan/settings/delete", ensureAdmin, async (req, res) => {
    try {
        const { id } = req.body;

        if (!id) return res.status(400).send("Invalid setting ID");

        // Delete the setting
        await LoanSettings.findByIdAndDelete(id);

        // Redirect back to the loan settings page
        res.redirect("/admin/loan/settings");

    } catch (error) {
        console.error("Error deleting loan setting:", error);
        res.status(500).send("Failed to delete loan setting");
    }
});



// SETTINGS ROUTE 
router.get("/admin/settings", ensureAdmin, async (req, res) => {
  try {
    const settings = await Settings.getSettings();

    res.render("dashboard/admin/settings", {
      admin: req.user,
      settings
    });
  } catch (error) {
    console.error("Error fetching settings:", error);
    res.status(500).send("Internal Server Error");
  }
});


// Update ONLY interest rates
router.post("/admin/settings/interest-rates", ensureAdmin, async (req, res) => {
  console.log(req.body)
  try {
    const { clubRate, nonClubRate } = req.body;

    const settings = await Settings.getSettings();

    settings.interestRates.clubMemberRate = clubRate;
    settings.interestRates.nonClubMemberRate = nonClubRate;

    await settings.save();

    res.json({ success: true, message: "Interest rates updated!" });

  } catch (err) {
    console.error("Error updating interest:", err);
    res.status(500).json({ success: false, message: "Failed to update interest" });
  }
});

// Update Registration Fees
router.post("/admin/settings/registration-fees", ensureAdmin, async (req, res) => {
  try {
    const { adultFee, kiddiesFee } = req.body;

    const settings = await Settings.getSettings();

    settings.registrationFees.adultRegistrationFee = adultFee;
    settings.registrationFees.kiddiesRegistrationFee = kiddiesFee;

    await settings.save();

    res.json({ success: true, message: "Registration fees updated successfully!" });

  } catch (err) {
    console.error("Error updating registration fees:", err);
    res.status(500).json({ success: false, message: "Failed to update registration fees" });
  }
});

// Update Kiddies Account Settings
router.post("/admin/settings/kiddies-settings", ensureAdmin, async (req, res) => {
  try {
    const {
      minAge,
      maxAge,
      upgradeAge,
      monthlyFee,
      upgradeFee,
      interestRate,
      notificationDays
    } = req.body;

    const settings = await Settings.getSettings();

    settings.kiddiesSettings.minAge = minAge;
    settings.kiddiesSettings.maxAge = maxAge;
    settings.kiddiesSettings.upgradeAge = upgradeAge;
    settings.kiddiesSettings.monthlyMaintenanceFee = monthlyFee;
    settings.kiddiesSettings.upgradeProcessingFee = upgradeFee;
    settings.kiddiesSettings.kiddiesInterestRate = interestRate;

    // Enum is 30, 60, 90 – ensure valid fallback
    settings.kiddiesSettings.autoUpgradeNotificationDays =
      [30, 60, 90].includes(Number(notificationDays)) ? notificationDays : 60;

    await settings.save();

    res.json({ success: true, message: "Kiddies settings updated successfully!" });

  } catch (err) {
    console.error("Error updating kiddies settings:", err);
    res.status(500).json({ success: false, message: "Failed to update kiddies settings" });
  }
});


// Update Additional Fees & Charges
router.post("/admin/settings/other-fees", ensureAdmin, async (req, res) => {
  try {
    const { forceWithdrawal, loanProcessing, roiOperating } = req.body;

    const settings = await Settings.getSettings();

    settings.otherFees.forceWithdrawalCharge = forceWithdrawal;
    settings.otherFees.loanProcessingFee = loanProcessing; // optional if you want to store separately
    settings.otherFees.roiOperatingCharge = roiOperating;

    await settings.save();

    res.json({ success: true, message: "Additional fees updated successfully!" });

  } catch (err) {
    console.error("Error updating other fees:", err);
    res.status(500).json({ success: false, message: "Failed to update additional fees" });
  }
});

module.exports = router;
