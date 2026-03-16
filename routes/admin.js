const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const Admin = require("../models/Admin");
const User = require("../models/User");
const Settings = require("../models/Settings");
const MemberType = require("../models/MemberType");
const Account = require("../models/Account");
const Payment = require("../models/Payment");
const Transaction = require("../models/Transaction");

const KiddiesTransaction = require("../models/Kiddies/kiddiesTransaction");
const KiddiesPayment = require("../models/Kiddies/KiddiesPayment");


const AdminPayment = require("../models/AdminPayment");
const Withdrawal = require("../models/Withdrawal");
const ExtraCharge = require("../models/ExtraCharge");
const Permission = require("../models/Permission");
const Role = require("../models/Role");
const { Service, PaymentHistory, SubscriptionStatus } = require('../models/Servicesubscription');
const TransactionApproval = require("../models/transactionApproval");
const {
  DepositReport,
  WithdrawalReport,
  LoanReport,
  AdminActionLog,
  SubscriptionReport,
} = require("../models/ReportSchemas");


const Loan           = require("../models/Loan");
const LoanLedger     = require("../models/LoanLedger");
const KiddiesAccount = require("../models/Kiddies/kiddiesAccount");
 

const CompanyLedger = require("../models/CompanyLedger");



const OperatingLedger = require("../models/OperatingLedger");


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


// ── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(date) {
    const s = Math.floor((Date.now() - new Date(date)) / 1000);
    if (s < 60)    return `${s}s ago`;
    if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}
 
function greeting() {
    const h = new Date().getHours();
    if (h < 12) return "morning";
    if (h < 17) return "afternoon";
    return "evening";
}
 
function parseDateRange(query) {
    const { from, to, period } = query;
    const now      = new Date();
    const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    const fmtLabel = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
 
    if (period && period !== "all") {
        let start;
        let label;
        switch (period) {
            case "today":
                start = new Date(now); start.setHours(0, 0, 0, 0);
                label = "Today";
                break;
            case "7d":
                start = new Date(now); start.setDate(start.getDate() - 6); start.setHours(0,0,0,0);
                label = "Last 7 Days";
                break;
            case "30d":
                start = new Date(now); start.setDate(start.getDate() - 29); start.setHours(0,0,0,0);
                label = "Last 30 Days";
                break;
            case "this_month":
                start = new Date(now.getFullYear(), now.getMonth(), 1);
                label = now.toLocaleString("en-US", { month: "long", year: "numeric" });
                break;
            case "last_month": {
                const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const e = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
                return { dateFilter: { $gte: s, $lte: e }, fromDate: s, toDate: e,
                         periodLabel: s.toLocaleString("en-US", { month: "long", year: "numeric" }) };
            }
            case "this_year":
                start = new Date(now.getFullYear(), 0, 1);
                label = `Year ${now.getFullYear()}`;
                break;
            default:
                return { dateFilter: {}, fromDate: null, toDate: null, periodLabel: "All Time" };
        }
        return { dateFilter: { $gte: start, $lte: todayEnd }, fromDate: start, toDate: todayEnd, periodLabel: label };
    }
 
    if (from || to) {
        const fd = from ? new Date(from + "T00:00:00.000Z") : new Date(0);
        const td = to   ? new Date(to   + "T23:59:59.999Z") : todayEnd;
        return {
            dateFilter: { $gte: fd, $lte: td },
            fromDate: fd, toDate: td,
            periodLabel: `${fmtLabel(fd)} – ${fmtLabel(td)}`,
        };
    }
 
    return { dateFilter: {}, fromDate: null, toDate: null, periodLabel: "All Time" };
}
 
// ── Route ────────────────────────────────────────────────────────────────────
router.get(
    "/admin/dashboard",
    ensureAdmin("view_dashboard"),
    async (req, res) => {
        try {
            const { dateFilter, periodLabel } = parseDateRange(req.query);
            const hasFilter = Object.keys(dateFilter).length > 0;
            const createdIn = hasFilter ? { createdAt: dateFilter } : {};

            // ── 1. MEMBER STATS ───────────────────────────────────────────────
            const [totalMembers, activeMembers, pendingMembers, rejectedMembers, newInPeriod] =
                await Promise.all([
                    User.countDocuments({}),
                    User.countDocuments({ status: "active"   }),
                    User.countDocuments({ status: "pending"  }),
                    User.countDocuments({ status: "rejected" }),
                    User.countDocuments({ ...createdIn }),
                ]);

            // ── 2. ACCOUNT BALANCES (always live — not date-filtered) ─────────
            const [memberBalAgg, kiddiesBalAgg] = await Promise.all([
                Account.aggregate([
                    { $match: { ownerType: "User" } },
                    { $group: { _id: null, total: { $sum: "$balance" } } },
                ]),
                Account.aggregate([
                    { $match: { ownerType: "KiddiesAccount" } },
                    { $group: { _id: null, total: { $sum: "$balance" } } },
                ]),
            ]);
            const totalMemberBalance = memberBalAgg[0]?.total  || 0;
            const kiddiesBalance     = kiddiesBalAgg[0]?.total || 0;

            // ── 3. DEPOSITS ───────────────────────────────────────────────────
            const depositMatch = {
                paymentType: { $exists: false },
                status:      { $in: ["paid", "success"] },
                amount:      { $gt: 0 },
                ...createdIn,
            };

            const [depositAgg, depositCountPeriod] = await Promise.all([
                Payment.aggregate([
                    { $match: depositMatch },
                    { $group: { _id: null, total: { $sum: "$amount" } } },
                ]),
                Payment.countDocuments(depositMatch),
            ]);
            const totalDeposits    = depositAgg[0]?.total || 0;
            const depositsInPeriod = depositCountPeriod;

            // ── 4. WITHDRAWALS ────────────────────────────────────────────────
            const [wdAgg, wdCountPeriod, wdPendingCount, wdPendingAmtAgg, wdPenaltyAgg] =
                await Promise.all([
                    Withdrawal.aggregate([
                        { $match: { status: "success", ...createdIn } },
                        { $group: { _id: null, total: { $sum: "$amount" } } },
                    ]),
                    Withdrawal.countDocuments({ status: "success", ...createdIn }),
                    Withdrawal.countDocuments({ status: { $in: ["pending", "processing"] } }),
                    Withdrawal.aggregate([
                        { $match: { status: { $in: ["pending", "processing"] } } },
                        { $group: { _id: null, total: { $sum: "$amount" } } },
                    ]),
                    Withdrawal.aggregate([
                        { $match: { status: "success", penaltyAmount: { $gt: 0 }, ...createdIn } },
                        { $group: { _id: null, total: { $sum: "$penaltyAmount" } } },
                    ]),
                ]);
            const totalWithdrawals         = wdAgg[0]?.total          || 0;
            const withdrawalsInPeriod      = wdCountPeriod;
            const pendingWithdrawalCount   = wdPendingCount;
            const pendingWithdrawalsAmount = wdPendingAmtAgg[0]?.total || 0;
            const withdrawalPenalties      = wdPenaltyAgg[0]?.total    || 0;

            // ── 5. REGISTRATION FEES ──────────────────────────────────────────
            const regFeeAgg = await Payment.aggregate([
                { $match: { paymentType: "registration_fee", status: "success", ...createdIn } },
                { $group: { _id: null, total: { $sum: "$amount" } } },
            ]);
            const registrationFees = regFeeAgg[0]?.total || 0;

            // ── 6. LOANS ──────────────────────────────────────────────────────
            const loanQuery = hasFilter ? { createdAt: dateFilter } : {};
            const [loansInPeriod, allLoansLive] = await Promise.all([
                Loan.find(loanQuery).lean(),
                Loan.find({}).lean(),
            ]);

            const totalLoansDisbursed = loansInPeriod.reduce((s, l) => s + (l.amount || 0), 0);
            const totalLoansRepaid    = allLoansLive.reduce((s, l) => s + (l.paidAmount || 0), 0);
            const outstandingBalance  = allLoansLive.reduce((s, l) => {
                const b = (l.totalRepay || l.amount || 0) - (l.paidAmount || 0);
                return s + Math.max(b, 0);
            }, 0);

            const today            = new Date();
            const activeLoansCount = allLoansLive.filter(l =>
                l.status === "approved" && ((l.totalRepay || 0) - (l.paidAmount || 0)) > 0
            ).length;
            const completedCount   = allLoansLive.filter(l =>
                (l.paidAmount || 0) >= (l.totalRepay || 1) && (l.totalRepay || 0) > 0
            ).length;
            const overdueCount     = allLoansLive.filter(l => {
                const b = (l.totalRepay || 0) - (l.paidAmount || 0);
                return b > 0 && l.dueDate && new Date(l.dueDate) < today;
            }).length;
            const externalCount    = allLoansLive.filter(l => l.external).length;
            const allTimeDisbursed = allLoansLive.reduce((s, l) => s + (l.amount || 0), 0);
            const recoveryRate     = allTimeDisbursed > 0
                ? Math.round((totalLoansRepaid / allTimeDisbursed) * 100)
                : 0;

            // Loan ledger — interest & penalties
            const [interestAgg, loanPenaltyAgg, repayCountAgg] = await Promise.all([
                LoanLedger.aggregate([
                    { $match: { transactionType: "repayment", ...createdIn } },
                    { $group: { _id: null, total: { $sum: "$interestPaid" } } },
                ]),
                LoanLedger.aggregate([
                    { $match: { transactionType: { $in: ["repayment", "penalty"] }, ...createdIn } },
                    { $group: { _id: null, total: { $sum: "$penaltyPaid" } } },
                ]),
                LoanLedger.countDocuments({ transactionType: "repayment", ...createdIn }),
            ]);
            const interestCollected   = interestAgg[0]?.total    || 0;
            const loanPenalties       = loanPenaltyAgg[0]?.total || 0;
            const repaymentsInPeriod  = repayCountAgg;
            const pendingLoanPayments = await LoanLedger.countDocuments({ status: "pending" }).catch(() => 0);

            // ── 7. EXTRA CHARGES ──────────────────────────────────────────────
            let finalExtraCharges = 0;
            if (ExtraCharge) {
                const ecAgg = await ExtraCharge.aggregate([
                    { $match: { status: { $in: ["approved", "paid"] }, ...createdIn } },
                    { $group: { _id: null, total: { $sum: "$amount" } } },
                ]).catch(() => []);
                finalExtraCharges = ecAgg[0]?.total || 0;
            }
            if (!finalExtraCharges) {
                const ecPayAgg = await Payment.aggregate([
                    { $match: { paymentType: "extra_charge", status: "success", ...createdIn } },
                    { $group: { _id: null, total: { $sum: "$amount" } } },
                ]).catch(() => []);
                finalExtraCharges = ecPayAgg[0]?.total || 0;
            }

            // ── 8. COMPANY REVENUE ────────────────────────────────────────────
            const companyRevenue   = interestCollected + registrationFees + withdrawalPenalties + loanPenalties + finalExtraCharges;
            const revenueBreakdown = [
                { label: "Loan Interest",        value: interestCollected,   color: "#f59e0b", pct: 0 },
                { label: "Registration Fees",    value: registrationFees,    color: "#3b82f6", pct: 0 },
                { label: "Withdrawal Penalties", value: withdrawalPenalties, color: "#ef4444", pct: 0 },
                { label: "Loan Penalties",       value: loanPenalties,       color: "#8b5cf6", pct: 0 },
                { label: "Extra Charges",        value: finalExtraCharges,   color: "#06b6d4", pct: 0 },
            ];
            if (companyRevenue > 0) {
                revenueBreakdown.forEach(r => { r.pct = Math.round((r.value / companyRevenue) * 100); });
            }

            // ── 9. KIDDIES STATS ──────────────────────────────────────────────
            const [kiddiesTotal, kiddiesPendingApproval, kiddiesActive] = await Promise.all([
                KiddiesAccount.countDocuments({}),
                KiddiesAccount.countDocuments({ status: "locked", registrationStatus: "paid" }),
                KiddiesAccount.countDocuments({ status: "active" }),
            ]);

            // ── 10. PENDING APPROVALS ─────────────────────────────────────────
            const [pendingApprovals, pendingDeposits] = await Promise.all([
                Payment.countDocuments({ status: "pending" }).catch(() => 0),
                Payment.countDocuments({
                    paymentType: { $exists: false },
                    status:      "pending",
                    amount:      { $gt: 0 },
                }).catch(() => 0),
            ]);

            // ── 11. RECENT TRANSACTIONS FEED ─────────────────────────────────
            const rawRecent = await Payment.find({ ...createdIn })
                .sort({ createdAt: -1 })
                .limit(10)
                .populate({ path: "user", select: "firstName lastName membershipID" })
                .lean()
                .catch(() => []);

            const txTypeMap = {
                deposit:          { icon: "fa-arrow-down",       color: "#10b981", label: "Deposit",        sign: "+" },
                loan_repayment:   { icon: "fa-hand-holding-usd", color: "#f59e0b", label: "Loan Repayment", sign: ""  },
                registration_fee: { icon: "fa-id-card",          color: "#3b82f6", label: "Registration",   sign: "+" },
                penalty_payment:  { icon: "fa-bolt",             color: "#ef4444", label: "Penalty",        sign: ""  },
                extra_charge:     { icon: "fa-minus-circle",     color: "#8b5cf6", label: "Extra Charge",   sign: "-" },
                external_payment: { icon: "fa-building",         color: "#06b6d4", label: "External",       sign: ""  },
            };
            const statusColorMap = {
                success: "#10b981",
                paid:    "#10b981",
                pending: "#f59e0b",
                failed:  "#ef4444",
            };

            const resolveType = (tx) => {
                if (tx.paymentType) return tx.paymentType;
                if (tx.paystackResponse?.metadata?.type === "deposit") return "deposit";
                if (tx.paystackResponse?.adminNote)                    return "deposit";
                return null;
            };

            const recentTransactions = rawRecent.map(tx => {
                const typeKey = resolveType(tx);
                const t = txTypeMap[typeKey] || { icon: "fa-circle", color: "#64748b", label: "Payment", sign: "" };
                return {
                    memberName:   tx.user
                        ? `${tx.user.firstName} ${tx.user.lastName}`
                        : (tx.payeeName || "Unknown"),
                    membershipID: tx.user?.membershipID || "",
                    amount:       tx.amount || 0,
                    typeLabel:    t.label,
                    typeIcon:     t.icon,
                    typeColor:    t.color,
                    sign:         t.sign,
                    status:       (tx.status || "").charAt(0).toUpperCase() + (tx.status || "").slice(1),
                    statusColor:  statusColorMap[tx.status] || "#64748b",
                    timeAgo:      timeAgo(tx.createdAt),
                };
            });

            // ── 12. TOP MEMBERS BY BALANCE ────────────────────────────────────
            const topAccountDocs = await Account.find({ ownerType: "User" })
                .sort({ balance: -1 })
                .limit(7)
                .populate({ path: "ownerId", select: "firstName lastName membershipID", model: "User" })
                .lean()
                .catch(() => []);

            const topMembers = topAccountDocs
                .filter(a => a.ownerId)
                .map(a => ({
                    name:         `${a.ownerId.firstName} ${a.ownerId.lastName}`,
                    membershipID: a.ownerId.membershipID || "N/A",
                    balance:      a.balance || 0,
                    initials:     (
                        (a.ownerId.firstName?.[0] || "") +
                        (a.ownerId.lastName?.[0]  || "")
                    ).toUpperCase(),
                }));

            // ── RENDER ────────────────────────────────────────────────────────
            res.render("dashboard/admin/overview", {
                admin:          req.user,
                timeGreeting:   greeting(),
                totalPortfolio: totalMemberBalance + kiddiesBalance + outstandingBalance,
                periodLabel,
                filterValues: {
                    period: req.query.period || "",
                    from:   req.query.from   || "",
                    to:     req.query.to     || "",
                },
                stats: {
                    members: {
                        total:       totalMembers,
                        active:      activeMembers,
                        pending:     pendingMembers,
                        rejected:    rejectedMembers,
                        newInPeriod,
                    },
                    finance: {
                        totalMemberBalance,
                        kiddiesBalance,
                        totalDeposits,
                        depositsInPeriod,
                        totalWithdrawals,
                        withdrawalsInPeriod,
                        netPosition:             totalDeposits - totalWithdrawals,
                        pendingWithdrawalsAmount,
                        companyRevenue,
                        revenueBreakdown,
                        registrationFees,
                        withdrawalPenalties,
                        finalExtraCharges,
                    },
                    loans: {
                        totalCount:        loansInPeriod.length,
                        totalDisbursed:    totalLoansDisbursed,
                        totalRepaid:       totalLoansRepaid,
                        outstandingBalance,
                        activeCount:       activeLoansCount,
                        completedCount,
                        overdueCount,
                        externalCount,
                        recoveryRate,
                        interestCollected,
                        loanPenalties,
                        repaymentsInPeriod,
                    },
                    kiddies: {
                        totalBalance:    kiddiesBalance,
                        totalAccounts:   kiddiesTotal,
                        pendingApproval: kiddiesPendingApproval,
                        activeAccounts:  kiddiesActive,
                    },
                    pending: {
                        approvals:    pendingApprovals,
                        withdrawals:  pendingWithdrawalCount,
                        loanPayments: pendingLoanPayments,
                        deposits:     pendingDeposits,
                    },
                },
                recentTransactions,
                topMembers,
            });

        } catch (err) {
            console.error("[Admin] Overview dashboard error:", err);
            res.status(500).send("Internal Server Error");
        }
    }
);



// HANDLING MEMBERS ONBOARDING, MEMBER TYPES MANAGEMENT - TECHMAYOR COMPANY LIMITED
router.get(
  '/admin-dashboard',
  ensureAdmin("view_members"),
  async (req, res) => {
    try {
      const users = await User.find()
        .populate({
          path: "account",
          populate: {
            path: "accountType",
          }
        });

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
  }
);

router.post(
  '/admin/members/approve/:id',
  ensureAdmin("approve_members"),
  async (req, res) => {
    try {
      const userId = req.params.id;
      const { memberTypeId } = req.body;

      // ── 1. Validate ───────────────────────────────────────────────────────
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const type = await MemberType.findById(memberTypeId);
      if (!type) {
        return res.status(404).json({ message: "Member type not found" });
      }

      // ── 2. Remove old membershipID + referralCode ─────────────────────────
      const oldMembershipID = user.membershipID;
      user.membershipID = null;
      user.referralCode = null;
      await user.save();

      // ── 3. Safe membership ID generation ─────────────────────────────────
      const usersOfType = await User.find({
        membershipID: { $regex: `^${type.shortCode}\\d+$` }
      }).select("membershipID");

      let maxNumber = 0;
      for (const u of usersOfType) {
        const match = u.membershipID?.match(/\d+$/);
        if (match) {
          const num = parseInt(match[0], 10);
          if (num > maxNumber) maxNumber = num;
        }
      }

      const newMembershipID =
        `${type.shortCode}${String(maxNumber + 1).padStart(4, "0")}`;

      // ── 4. Assign new identity ────────────────────────────────────────────
      user.status       = "active";
      user.membershipID = newMembershipID;
      user.referralCode = newMembershipID;

      // ── 5. Set registrationStatus to paid if still pending ────────────────
      if (user.registrationStatus === "pending") {
        user.registrationStatus = "paid";
      }

      await user.save();

      // ── 6. Update or create Account ───────────────────────────────────────
      let account = await Account.findOne({
        ownerType: "User",
        ownerId:   user._id
      });

      if (!account) {
        account = await Account.create({
          ownerType:       "User",
          ownerId:         user._id,
          accountType:     type._id,
          balance:         0,
          monthlyROI:      type.interestRate || 0,
          accumulativeROI: 0,
        });
        user.account = account._id;
        await user.save();
      } else {
        account.accountType = type._id;
        account.monthlyROI  = type.interestRate || 0;
        await account.save();
      }

      console.log(
        `[APPROVE MEMBER] ${user._id} | ${oldMembershipID} → ${newMembershipID} | ${type.name} | registrationStatus: ${user.registrationStatus}`
      );

      return res.json({
        message:            "Member approved successfully",
        membershipID:       newMembershipID,
        memberTypeName:     type.name,
        email:              user.email,
        registrationStatus: user.registrationStatus,
      });

    } catch (err) {
      console.error("Approve member error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// Delete member and all associated data
router.post("/members/delete/:id", ensureAdmin("delete_members"), async (req, res) => {
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

router.post(
  "/admin/members/edit/:id",
  ensureAdmin("edit_members"),
  async (req, res) => {
    try {
      const userId = req.params.id;

      const {
        // Personal
        firstName, lastName, email, phone, dob,
        state, lga, address,
        // Bank
        bankName, accountNumber, accountName,
        // Next of Kin
        nokFullName, nokRelationship, nokPhone, nokAddress,
        // Status & type
        status, memberTypeId,
        // ID details (non-file)
        idType, idNumber,
      } = req.body;

      const user = await User.findById(userId).populate({
        path: "account",
        populate: { path: "accountType" },
      });

      if (!user) {
        return res.status(404).json({ status: false, message: "User not found" });
      }

      // ── 1. Update scalar fields ────────────────────────────
      if (firstName)    user.firstName = firstName.trim();
      if (lastName)     user.lastName  = lastName.trim();
      if (email)        user.email     = email.toLowerCase().trim();
      if (phone)        user.phone     = phone.trim();
      if (dob)          user.dob       = new Date(dob);
      if (state)        user.state     = state.trim();
      if (lga)          user.lga       = lga.trim();
      if (address)      user.address   = address.trim();
      if (idType)       user.idType    = idType;
      if (idNumber)     user.idNumber  = idNumber.trim();
      if (status)       user.status    = status;

      // ── 2. Bank details ───────────────────────────────────
      user.bankDetails = {
        bankName:      bankName      || user.bankDetails?.bankName      || "",
        accountNumber: accountNumber || user.bankDetails?.accountNumber || "",
        accountName:   accountName   || user.bankDetails?.accountName   || "",
      };

      // ── 3. Next of Kin ────────────────────────────────────
      user.nextOfKin = {
        fullName:     nokFullName     || user.nextOfKin?.fullName     || "",
        relationship: nokRelationship || user.nextOfKin?.relationship || "",
        phone:        nokPhone        || user.nextOfKin?.phone        || "",
        address:      nokAddress      || user.nextOfKin?.address      || "",
      };

      // ── 4. Member Type change (generates new membership ID) ─
      let newMemberTypeName = null;
      let newMembershipID   = null;

      if (memberTypeId) {
        const currentTypeId = user.account?.accountType?._id?.toString();

        if (memberTypeId !== currentTypeId) {
          const type = await MemberType.findById(memberTypeId);
          if (!type) {
            return res.status(404).json({ status: false, message: "Member type not found" });
          }

          // Generate sequential ID for new type
          const lastUser = await User
            .findOne({ membershipID: { $regex: `^${type.shortCode}` } })
            .sort({ membershipID: -1 })
            .lean();

          let nextNumber = 1;
          if (lastUser?.membershipID) {
            const num = parseInt(lastUser.membershipID.replace(type.shortCode, ""), 10);
            if (!isNaN(num)) nextNumber = num + 1;
          }

          newMembershipID   = `${type.shortCode}${String(nextNumber).padStart(4, "0")}`;
          newMemberTypeName = type.name;

          // Clear old membership ID, assign new one
          user.membershipID = newMembershipID;

          // Update / create account
          let account = await Account.findOne({ user: user._id });
          if (!account) {
            account = new Account({ user: user._id, accountType: type._id });
          } else {
            account.accountType = type._id;
          }
          await account.save();

          // Re-link account to user if needed
          if (!user.account || user.account.toString() !== account._id.toString()) {
            user.account = account._id;
          }
        }
      }

      await user.save();

      return res.json({
        status: true,
        message: "Member updated successfully",
        ...(newMembershipID && {
          newMembershipID,
          newMemberTypeName,
        }),
      });
    } catch (err) {
      console.error("Edit member error:", err);
      return res.status(500).json({ status: false, message: "Internal server error" });
    }
  }
);


router.post(
  "/admin/members/reject/:id",
  ensureAdmin("approve_members"), // reuse approve permission, or create "reject_members"
  async (req, res) => {
    try {
      const memberId = req.params.id;

      const user = await User.findById(memberId);
      if (!user) {
        return res.status(404).json({ status: false, message: "Member not found" });
      }

      if (user.status !== "pending") {
        return res.status(400).json({ 
          status: false, 
          message: "Only pending members can be rejected" 
        });
      }

      user.status = "rejected";
      await user.save();

      return res.json({ 
        status: true, 
        message: "Member has been rejected successfully" 
      });

    } catch (err) {
      console.error("Error rejecting member:", err);
      res.status(500).json({ status: false, message: "Error rejecting member" });
    }
  }
);

// POST /admin/members/change-type/:id
router.post('/admin/members/change-type/:id', ensureAdmin('edit_members'), async (req, res) => {
    try {
        const { memberTypeId } = req.body;

        // ── 1. Validate user & new type ──────────────────────────────────────
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ status: false, message: 'User not found' });

        const type = await MemberType.findById(memberTypeId);
        if (!type) return res.status(404).json({ status: false, message: 'Member type not found' });

        // ── 2. Prevent assigning the same type they already have ─────────────
        const account = await Account.findOne({
            ownerType: "User",
            ownerId:   user._id
        }).populate('accountType');

        if (account?.accountType?._id?.toString() === memberTypeId) {
            return res.status(400).json({
                status:  false,
                message: 'Member already has this membership type.'
            });
        }

        // ── 3. Clear the old membershipID first ──────────────────────────────
        const oldMembershipID = user.membershipID;
        user.membershipID = null;
        user.referralCode = null;
        await user.save();

        // ── 4. Safe membership ID generation ─────────────────────────────────
        const usersOfType = await User.find({
            membershipID: { $regex: `^${type.shortCode}\\d+$` }
        }).select("membershipID");

        let maxNumber = 0;
        for (const u of usersOfType) {
            const match = u.membershipID?.match(/\d+$/);
            if (match) {
                const num = parseInt(match[0], 10);
                if (num > maxNumber) maxNumber = num;
            }
        }

        const newMembershipID =
            `${type.shortCode}${String(maxNumber + 1).padStart(4, '0')}`;

        // ── 5. Assign new membershipID & referralCode ─────────────────────────
        user.membershipID = newMembershipID;
        user.referralCode = newMembershipID;
        await user.save();

        // ── 6. Update or create Account ───────────────────────────────────────
        if (!account) {
            // No account found — create one with ownerType: "User"
            const newAccount = await Account.create({
                ownerType:       "User",
                ownerId:         user._id,
                accountType:     type._id,
                balance:         0,
                monthlyROI:      type.interestRate || 0,
                accumulativeROI: 0,
            });
            user.account = newAccount._id;
            await user.save();
        } else {
            // Account exists — just update the type and rate
            account.accountType = type._id;
            account.monthlyROI  = type.interestRate || 0;
            await account.save();
        }

        console.log(
            `[CHANGE TYPE] User ${user._id} | ${oldMembershipID} → ${newMembershipID} | Type: ${type.name}`
        );

        return res.json({
            status:            true,
            newMembershipID,
            newMemberTypeName: type.name,
            oldMembershipID,
        });

    } catch (err) {
        console.error('Change type error:', err);
        res.status(500).json({ status: false, message: 'Internal server error' });
    }
});


// GET: Display Member Type Management Page
router.get("/admin/manage/memberType", ensureAdmin("view_membertype"), async (req, res) => {
  try {
    const memberTypes = await MemberType.find().sort({ name: 1 }).lean();

    // Count members for each type
    const users = await User.find({}, "account membershipID").lean();

    memberTypes.forEach(type => {
      type.members = users.filter(u => 
        u.membershipID?.startsWith(type.shortCode)
      ).length;
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

// POST: CREATE or UPDATE Member Type
router.post("/admin/manage/memberType", ensureAdmin("create_membertype"), async (req, res) => {
  try {
    const {
      id,
      name,
      shortCode,
      interestRate,
      isDefault,
      // Withdrawal settings
      forceWithdrawalPenalty,
      earlyWithdrawalPeriodMonths,
      allowForcedWithdrawal,
      // Loan settings
      loanRolloverRate,
      loanPenaltyRate,
      loanPenaltyType,
      gracePeriodDays,
      maxLoanAmount,
      minDepositBeforeLoan,
      loanToDepositRatio,
      // ROI settings
      roiDistributionFrequency,
      minimumBalanceForROI
    } = req.body;

    // Validation
    if (!name || !shortCode) {
      return res.status(400).json({
        success: false,
        message: "Name and shortcode are required",
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
        {
          name,
          shortCode: newShortCode,
          interestRate: parseFloat(interestRate) || 0,
          isDefault: isDefault || false,
          // Withdrawal settings
          forceWithdrawalPenalty: parseFloat(forceWithdrawalPenalty) || 0,
          earlyWithdrawalPeriodMonths: parseInt(earlyWithdrawalPeriodMonths) || 0,
          allowForcedWithdrawal: allowForcedWithdrawal !== false,
          // Loan settings
          loanRolloverRate: parseFloat(loanRolloverRate) || 0,
          loanPenaltyRate: parseFloat(loanPenaltyRate) || 0,
          loanPenaltyType: loanPenaltyType || 'percentage',
          gracePeriodDays: parseInt(gracePeriodDays) || 0,
          maxLoanAmount: parseFloat(maxLoanAmount) || 0,
          minDepositBeforeLoan: parseFloat(minDepositBeforeLoan) || 0,
          loanToDepositRatio: parseFloat(loanToDepositRatio) || 80,
          // ROI settings
          roiDistributionFrequency: roiDistributionFrequency || 'monthly',
          minimumBalanceForROI: parseFloat(minimumBalanceForROI) || 0
        },
        { new: true, runValidators: true }
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

        console.log(`✅ Users updated: ${updatedCount}`);
      }

      return res.json({
        success: true,
        message: "Membership type updated successfully",
        memberType: updated,
      });
    }

    // CREATE new MemberType
    const newType = new MemberType({
      name,
      shortCode: shortCode.trim(),
      interestRate: parseFloat(interestRate) || 0,
      isDefault: isDefault || false,
      // Withdrawal settings
      forceWithdrawalPenalty: parseFloat(forceWithdrawalPenalty) || 2,
      earlyWithdrawalPeriodMonths: parseInt(earlyWithdrawalPeriodMonths) || 6,
      allowForcedWithdrawal: allowForcedWithdrawal !== false,
      // Loan settings
      loanRolloverRate: parseFloat(loanRolloverRate) || 0,
      loanPenaltyRate: parseFloat(loanPenaltyRate) || 0,
      loanPenaltyType: loanPenaltyType || 'percentage',
      gracePeriodDays: parseInt(gracePeriodDays) || 0,
      maxLoanAmount: parseFloat(maxLoanAmount) || 0,
      minDepositBeforeLoan: parseFloat(minDepositBeforeLoan) || 0,
      loanToDepositRatio: parseFloat(loanToDepositRatio) || 80,
      // ROI settings
      roiDistributionFrequency: roiDistributionFrequency || 'monthly',
      minimumBalanceForROI: parseFloat(minimumBalanceForROI) || 0
    });

    await newType.save();

    return res.json({
      success: true,
      message: "Membership type created successfully",
      memberType: newType,
    });
  } catch (error) {
    console.error("Error saving member type:", error);
    return res.status(500).json({
      success: false,
      message: "Server error: " + error.message,
    });
  }
});

// DELETE Member Type
router.delete("/admin/manage/memberType/:id", ensureAdmin("delete_membertype"), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if any users are using this membership type
    const users = await User.find({}).lean();
    const memberType = await MemberType.findById(id);
    
    if (!memberType) {
      return res.json({ 
        success: false, 
        message: "Membership type not found" 
      });
    }

    const usersWithType = users.filter(u => 
      u.membershipID?.startsWith(memberType.shortCode)
    );

    if (usersWithType.length > 0) {
      return res.json({
        success: false,
        message: `Cannot delete: ${usersWithType.length} member(s) are using this type`
      });
    }

    await MemberType.findByIdAndDelete(id);

    return res.json({ 
      success: true, 
      message: "Membership type deleted successfully" 
    });

  } catch (error) {
    console.error("Error deleting member type:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Server error: " + error.message 
    });
  }
});

// GET: Fetch specific membership type settings (useful for loan/withdrawal logic)
router.get("/api/memberType/:id", async (req, res) => {
  try {
    const memberType = await MemberType.findById(req.params.id);
    
    if (!memberType) {
      return res.status(404).json({
        success: false,
        message: "Membership type not found"
      });
    }

    res.json({
      success: true,
      memberType
    });
  } catch (error) {
    console.error("Error fetching member type:", error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

// GET: Fetch membership type by shortCode (useful for user operations)
router.get("/api/memberType/byCode/:shortCode", async (req, res) => {
  try {
    const memberType = await MemberType.findOne({ 
      shortCode: req.params.shortCode 
    });
    
    if (!memberType) {
      return res.status(404).json({
        success: false,
        message: "Membership type not found"
      });
    }

    res.json({
      success: true,
      memberType
    });
  } catch (error) {
    console.error("Error fetching member type:", error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

// ENDS HERE 


// HANDLING PAYMENTS MANAGEMENT -------------- TECHMAYOR COMPANY LIMITED 


// ADMIN PAYMENT ROUTES 
router.get(
  "/admin/manage-payment",
  ensureAdmin("view_transactions"),
  async (req, res) => {
    try {
      const adminPayments = await AdminPayment.find()
        .populate({ path: "admin", select: "firstName lastName email membershipID" })
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
          populate: { path: "duration", model: "LoanSettings" },
        })
        .sort({ createdAt: -1 });
      const memberRole = await Role.findOne({ name: /^member$/i }).select("_id");

      const availableApprovers = await User.find({
        role: { $ne: memberRole?._id },   // not the member role
        status: "active",
        _id: { $ne: req.user._id },       // exclude self
      })
        .populate("role", "name")
        .select("firstName lastName email membershipID role");

      res.render("dashboard/admin/payment", {
        admin: req.user,
        adminPayments,
        availableApprovers,
      });
    } catch (error) {
      console.error("Error fetching admin direct payments:", error);
      res.status(500).send("Internal Server Error");
    }
  }
);

/* ============================================================
   GET: Search Member (autocomplete)
============================================================ */
router.get("/admin/search-member", async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);

    const users = await User.find({
      $or: [
        { membershipID: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
        { firstName: { $regex: q, $options: "i" } },
        { lastName: { $regex: q, $options: "i" } },
      ],
    })
      .populate("account")
      .limit(5);

    const results = await Promise.all(
      users.map(async (u) => {
        const loans = await Loan.find({
          user: u._id,
          status: { $in: ["approved"] },
        })
          .select("amount totalRepay status dueDate createdAt")
          .populate({ path: "duration", select: "name months" });

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
            balanceRemaining: loan.totalRepay,
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

/* ============================================================
   POST: Submit Transaction for Approval
   - Creates a TransactionApproval record (status: "pending")
   - Does NOT touch member balance yet
============================================================ */
router.post(
  "/admin/submit-payment-for-approval",
  ensureAdmin("authorize_transactions"),
  async (req, res) => {

    console.log("========== SUBMIT PAYMENT START ==========");
    console.log("User:", req.user?._id);
    console.log("Request body:", req.body);

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
        selectedApprovers,
      } = req.body;

      /* ── Basic field validation ── */
      if (!memberId || !paymentType || !amount || !paymentMethod) {
        console.log("❌ Missing required fields");
        return res.status(400).json({
          success: false,
          message: "Missing required fields",
        });
      }

      console.log("✔ Fields validated");

      if (
        !selectedApprovers ||
        !Array.isArray(selectedApprovers) ||
        selectedApprovers.length < 3
      ) {
        console.log("❌ Not enough approvers:", selectedApprovers);
        return res.status(400).json({
          success: false,
          message: "You must select at least 3 approvers",
        });
      }

      console.log("✔ Approvers received:", selectedApprovers);

      /* ── Validate roles ── */
      const memberRole = await Role.findOne({ name: /^member$/i }).select("_id");
      console.log("Member role:", memberRole?._id);

      const approverUsers = await User.find({
        _id: { $in: selectedApprovers },
      }).populate("role", "name");

      console.log("Approver users found:", approverUsers.length);

      const invalidApprovers = approverUsers.filter(
        (u) => u.role?._id?.toString() === memberRole?._id?.toString()
      );

      if (invalidApprovers.length > 0) {
        const names = invalidApprovers
          .map((u) => `${u.firstName} ${u.lastName}`)
          .join(", ");

        console.log("❌ Invalid approvers:", names);

        return res.status(400).json({
          success: false,
          message:
            `These approvers have member role: ${names}`,
        });
      }

      console.log("✔ Approvers validated");

      /* ── Verify member ── */
      const member = await User.findById(memberId).populate("account");

      console.log("Member found:", !!member);
      console.log("Member account:", member?.account);

      if (!member || !member.account) {
        console.log("❌ Member account missing");
        return res.status(404).json({
          success: false,
          message: "Member account not found",
        });
      }

      const totalAmount = Number(amount) + Number(chargeAmount);
      console.log("Total amount:", totalAmount);
      console.log("Current balance:", member.account.balance);

      /* ── Balance validation ── */
      if (
        ["withdrawal", "direct-debit"].includes(paymentType) &&
        member.account.balance < totalAmount
      ) {
        console.log("❌ Insufficient balance");
        return res.status(400).json({
          success: false,
          message: "Member has insufficient balance",
        });
      }

      console.log("✔ Balance validated");

      /* ── Create approval ── */
      const approval = await TransactionApproval.create({
        initiatedBy: req.user._id,
        member: member._id,
        paymentType,
        amount: Number(amount),
        chargeAmount: Number(chargeAmount),
        totalAmount,
        paymentMethod,
        reference: reference || null,
        notes: notes || null,
        loan: loanId || null,
        chargeType: chargeType || null,
        selectedApprovers,
        status: "pending",
        approvalsRequired: 3,
        approvalCount: 0,
      });

      console.log("✅ Approval created:", approval._id);
      console.log("========== SUBMIT PAYMENT END ==========");

      res.json({
        success: true,
        message:
          "Transaction submitted for approval.",
        approvalId: approval._id,
      });

    } catch (err) {
      console.error("🔥 SUBMIT FOR APPROVAL ERROR:");
      console.error(err);
      console.error(err.stack);

      res.status(500).json({
        success: false,
        message: "Failed to submit transaction for approval",
        error: err.message,
      });
    }
  }
);


/* ============================================================
   GET: Approvals Inbox
   Shows pending transactions where req.user is a selected approver
   and has not yet voted.
============================================================ */
router.get(
  "/admin/transaction-approvals",
  ensureAdmin("view_transactions"),
  async (req, res) => {
    try {
      const userId = req.user._id;

      /* Transactions this user needs to act on */
      const pendingApprovals = await TransactionApproval.find({
        status: "pending",
        selectedApprovers: userId,
        "approvals.user": { $ne: userId },
      })
        .populate("initiatedBy", "firstName lastName email")
        .populate({
          path: "member",
          select: "firstName lastName membershipID email phone account",
          populate: { path: "account", select: "balance" },
        })
        .populate({
          path: "selectedApprovers",
          select: "firstName lastName",
        })
        .populate("loan", "amount totalRepay")
        .sort({ createdAt: -1 });

      /* Transactions this user has already acted on (last 20) */
      const actedApprovals = await TransactionApproval.find({
        selectedApprovers: userId,
        "approvals.user": userId,
      })
        .populate("initiatedBy", "firstName lastName email")
        .populate("member", "firstName lastName membershipID")
        .sort({ updatedAt: -1 })
        .limit(20);

      res.render("dashboard/admin/transaction-approvals", {
        admin: req.user,
        pendingApprovals,
        actedApprovals,
      });
    } catch (err) {
      console.error("Approvals page error:", err);
      res.status(500).send("Internal Server Error");
    }
  }
);

/* ============================================================
   POST: Approve a Transaction
============================================================ */
router.post(
  "/admin/approve-transaction/:approvalId",
  ensureAdmin("authorize_transactions"),
  async (req, res) => {
    try {
      const { approvalId } = req.params;
      const { comment } = req.body;
      const userId = req.user._id;

      const approval = await TransactionApproval.findById(approvalId);

      if (!approval) {
        return res.status(404).json({ message: "Approval request not found" });
      }

      if (approval.status !== "pending") {
        return res
          .status(400)
          .json({ message: `Transaction is already ${approval.status}` });
      }

      /* Must be a selected approver */
      const isSelected = approval.selectedApprovers
        .map((id) => id.toString())
        .includes(userId.toString());

      if (!isSelected) {
        return res
          .status(403)
          .json({ message: "You are not authorised to approve this transaction" });
      }

      /* Cannot vote twice */
      const alreadyVoted = approval.approvals.some(
        (a) => a.user.toString() === userId.toString()
      );

      if (alreadyVoted) {
        return res
          .status(400)
          .json({ message: "You have already responded to this transaction" });
      }

      /* Record vote */
      approval.approvals.push({
        user: userId,
        action: "approved",
        comment: comment || "",
        respondedAt: new Date(),
      });

      approval.approvalCount = approval.approvals.filter(
        (a) => a.action === "approved"
      ).length;

      /* Check if threshold reached */
      if (approval.approvalCount >= approval.approvalsRequired) {
        approval.status = "approved";
        await approval.save();

        const result = await finalizeTransaction(approval, req.user);

        if (!result.success) {
          /* Roll back status so it remains actionable */
          approval.status = "pending";
          await approval.save();
          return res.status(400).json({ message: result.message });
        }

        return res.json({
          success: true,
          message: "Transaction approved and processed successfully!",
          finalized: true,
          transaction: result.transaction,
        });
      }

      await approval.save();

      const remaining = approval.approvalsRequired - approval.approvalCount;

      return res.json({
        success: true,
        message: `Approval recorded. ${remaining} more approval(s) needed.`,
        finalized: false,
        approvalCount: approval.approvalCount,
        approvalsRequired: approval.approvalsRequired,
      });
    } catch (err) {
      console.error("Approve transaction error:", err);
      res.status(500).json({ message: "Failed to process approval" });
    }
  }
);

/* ============================================================
   POST: Decline a Transaction
   One decline immediately kills the transaction.
============================================================ */
router.post(
  "/admin/decline-transaction/:approvalId",
  ensureAdmin("authorize_transactions"),
  async (req, res) => {
    try {
      const { approvalId } = req.params;
      const { comment } = req.body;
      const userId = req.user._id;

      const approval = await TransactionApproval.findById(approvalId);

      if (!approval) {
        return res.status(404).json({ message: "Approval request not found" });
      }

      if (approval.status !== "pending") {
        return res
          .status(400)
          .json({ message: `Transaction is already ${approval.status}` });
      }

      const isSelected = approval.selectedApprovers
        .map((id) => id.toString())
        .includes(userId.toString());

      if (!isSelected) {
        return res
          .status(403)
          .json({ message: "You are not authorised to decline this transaction" });
      }

      const alreadyVoted = approval.approvals.some(
        (a) => a.user.toString() === userId.toString()
      );

      if (alreadyVoted) {
        return res
          .status(400)
          .json({ message: "You have already responded to this transaction" });
      }

      approval.approvals.push({
        user: userId,
        action: "declined",
        comment: comment || "",
        respondedAt: new Date(),
      });

      approval.status = "declined";
      approval.declinedReason = comment || "Declined by approver";
      approval.finalizedAt = new Date();

      await approval.save();

      return res.json({
        success: true,
        message: "Transaction has been declined.",
        finalized: true,
        status: "declined",
      });
    } catch (err) {
      console.error("Decline transaction error:", err);
      res.status(500).json({ message: "Failed to decline transaction" });
    }
  }
);

/* ============================================================
   GET: Pending approvals count (navbar badge)
============================================================ */
router.get(
  "/admin/pending-approvals-count",
  ensureAdmin("view_transactions"),
  async (req, res) => {
    try {
      const userId = req.user._id;
      const count = await TransactionApproval.countDocuments({
        status: "pending",
        selectedApprovers: userId,
        "approvals.user": { $ne: userId },
      });
      res.json({ count });
    } catch (err) {
      res.json({ count: 0 });
    }
  }
);

/* ============================================================
   HELPER: Finalize the transaction once 3 approvals are reached.
   - Updates account balance
   - Creates AdminPayment record
   - Creates Transaction record
   - Marks approval as 'processed'
============================================================ */
async function finalizeTransaction(approval, processingUser) {
  try {
    const member = await User.findById(approval.member).populate("account");

    if (!member || !member.account) {
      return { success: false, message: "Member account not found" };
    }

    const balanceBefore = member.account.balance;
    let balanceAfter = balanceBefore;
    const totalAmount = approval.totalAmount;

    /* ======================================================
       BALANCE CALCULATION
    ====================================================== */
    switch (approval.paymentType) {
      case "deposit":
        balanceAfter += totalAmount;
        break;

      case "withdrawal":
      case "direct-debit":
        if (balanceBefore < totalAmount) {
          return { success: false, message: "Insufficient balance" };
        }
        balanceAfter -= totalAmount;
        break;

      case "loan-repayment":
        // handled separately
        break;

      default:
        return { success: false, message: "Invalid payment type" };
    }

    member.account.balance = balanceAfter;
    await member.account.save();

    /* ======================================================
       CREATE ADMIN PAYMENT
    ====================================================== */
    const adminPayment = await AdminPayment.create({
      admin: approval.initiatedBy,
      member: member._id,
      paymentType: approval.paymentType,
      amount: approval.amount,
      chargeAmount: approval.chargeAmount,
      totalAmount: approval.totalAmount,
      loan: approval.loan || null,
      chargeType: approval.chargeType || null,
      paymentMethod: approval.paymentMethod,
      reference: approval.reference,
      notes: approval.notes,
      balanceBefore,
      balanceAfter,
      status: "successful",
    });

    /* ======================================================
       MEMBER TRANSACTION LEDGER
    ====================================================== */
    let transactionType = approval.paymentType;
    if (approval.paymentType === "loan-repayment")
      transactionType = "loan_payment";
    if (approval.paymentType === "direct-debit")
      transactionType = "withdrawal";

    await Transaction.create({
      user: member._id,
      type: transactionType,
      amount: totalAmount,
      status: "successful",
      description:
        approval.notes ||
        `Admin ${approval.paymentType.replace("-", " ")}`,
      reference: approval.reference || adminPayment._id.toString(),
      method: approval.paymentMethod,
    });

    /* ======================================================
       ✅ FINANCIAL REPORT RECORDING
    ====================================================== */

    // -------- DEPOSIT REPORT --------
    if (approval.paymentType === "deposit") {
      await DepositReport.create({
        member: member._id,
        account: member.account._id,
        amount: totalAmount,
        type: approval.paymentMethod || "bank_transfer",
        reference: approval.reference,
        description:
          approval.notes || "Admin approved deposit",
        status: "approved",

        balanceBefore,
        balanceAfter,

        processedBy: processingUser?._id,
        processedByRole:
          processingUser?.role?.name || "admin",
        processedAt: new Date(),

        notes: approval.notes,
      });
    }

    // -------- WITHDRAWAL REPORT --------
    if (
      approval.paymentType === "withdrawal" ||
      approval.paymentType === "direct-debit"
    ) {
      await WithdrawalReport.create({
        member: member._id,
        account: member.account._id,
        amount: totalAmount,
        netAmount: totalAmount,
        type: approval.paymentMethod || "bank_transfer",
        reference: approval.reference,
        description:
          approval.notes || "Admin processed withdrawal",

        status: "approved",

        balanceBefore,
        balanceAfter,

        approvedBy: processingUser?._id,
        approvedByRole:
          processingUser?.role?.name || "admin",
        approvedAt: new Date(),

        notes: approval.notes,
      });
    }

    /* ======================================================
       ✅ ADMIN ACTION LOG (AUDIT TRAIL)
    ====================================================== */
    await AdminActionLog.create({
      admin: processingUser?._id,
      adminRole: processingUser?.role?.name || "admin",
      actionType:
        approval.paymentType === "deposit"
          ? "deposit_approve"
          : "withdrawal_approve",

      targetUser: member._id,
      targetModel: "AdminPayment",
      targetId: adminPayment._id,

      description: `Processed ${approval.paymentType} for ${member.email}`,

      changes: {
        amount: totalAmount,
        balanceBefore,
        balanceAfter,
        reference: approval.reference,
      },

      status: "success",
    });

    /* ======================================================
       FINALIZE APPROVAL
    ====================================================== */
    approval.adminPayment = adminPayment._id;
    approval.status = "processed";
    approval.finalizedAt = new Date();
    await approval.save();

    return {
      success: true,
      transaction: {
        id: adminPayment._id,
        reference: approval.reference || adminPayment._id,
        date: adminPayment.createdAt,
        type: approval.paymentType,
        amount: approval.amount,
        chargeAmount: approval.chargeAmount,
        totalAmount: approval.totalAmount,
        balanceBefore,
        balanceAfter,
        paymentMethod: approval.paymentMethod,
        notes: approval.notes,
        member: {
          name: `${member.firstName} ${member.lastName}`,
          membershipID: member.membershipID,
          email: member.email,
          phone: member.phone,
        },
        processedBy: processingUser
          ? `${processingUser.firstName} ${processingUser.lastName}`
          : "System",
      },
    };
  } catch (err) {
    console.error("Finalize transaction error:", err);
    return { success: false, message: "Transaction finalization failed" };
  }
}


// DEPOSITS ROUTE STARTS HERE 
router.get("/admin/manage-deposits", ensureAdmin("view_deposits"), async (req, res) => {
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

    const deposits = payments.map((payment) => {
      const dateObj = new Date(payment.createdAt);
      const memberFullName = payment.user
        ? `${payment.user.firstName} ${payment.user.lastName}`
        : "N/A";

      const MANUAL_PREFIXES = [
        "COOP-",
        "LOAN-MANUAL-",
        "LOAN-INT-",
        "EXT-LOAN-",
        "MANUAL-REG-",
        "KD-NEW-",
        "KD-REG-MANUAL-",
      ];

      const isManual =
        payment.method === "Manual" ||
        payment.method === "Cash" ||
        payment.method === "Bank Transfer" ||
        MANUAL_PREFIXES.some(prefix => payment.reference.startsWith(prefix));

      // ── Amount ────────────────────────────────────────────────────────
      // Manual payments are stored in full Naira → display as-is.
      // Paystack payments are stored in kobo     → divide by 100.
      const amount = isManual
        ? payment.amount
        : payment.amount / 100;

      // Account balance is always stored in Naira
      const balance = payment.user?.account?.balance || 0;

      return {
        id:        payment._id,
        reference: payment.reference,

        date: dateObj.toLocaleDateString("en-US", {
          month: "short",
          day:   "numeric",
          year:  "numeric",
        }),

        time: dateObj.toLocaleTimeString("en-US", {
          hour:   "2-digit",
          minute: "2-digit",
        }),

        memberName:  memberFullName,
        payeeName:   payment.payeeName || null,
        memberId:    payment.user?.membershipID || "N/A",
        email:       payment.email,

        amount,
        balance,

        method: isManual ? "Manual Transfer" : "Paystack",

        // Normalise status labels for the view
        status:
          payment.status === "paid" || payment.status === "success"
            ? "approved"
            : payment.status === "failed"
            ? "rejected"
            : "pending",

        // Payment type badge in admin table (interest, principal, deposit)
        paymentType: payment.type || "deposit",

        notes: payment.paystackResponse?.adminNote
          || payment.paystackResponse?.message
          || payment.notes
          || "Deposit / Loan payment",
      };
    });

    // ── Stats ─────────────────────────────────────────────────────────────
    // Use the corrected `deposits` array so totalIncome is in Naira, not kobo
    const totalIncome = deposits
      .filter(d => d.status === "approved")
      .reduce((sum, d) => sum + d.amount, 0);

    const pendingCount = deposits.filter(d => d.status === "pending").length;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const approvedToday = payments.filter(p => {
      const created = new Date(p.createdAt);
      return (
        (p.status === "paid" || p.status === "success") &&
        created >= today
      );
    }).length;

    const activeMembers = new Set(
      payments.filter(p => p.user).map(p => p.user._id.toString())
    ).size;

    res.render("dashboard/admin/deposits", {
      admin: req.user,
      deposits,
      stats: {
        totalIncome,
        pendingCount,
        approvedToday,
        activeMembers,
      },
    });

  } catch (error) {
    console.error("Error fetching deposits:", error);
    res.status(500).send("Internal Server Error");
  }
});



router.post(
  "/admin/deposits/:id/approve",
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

      // Guard: loan payments must go through the dedicated loan route
      if (payment.loanId) {
        return res.status(400).json({
          message: "This is a loan payment. Use POST /admin/loans/:id/approve-payment instead.",
        });
      }

      const amount = Number(payment.amount);

      // ═══════════════════════════════════════════════════════════════════════
      // 2. HANDLE NORMAL DEPOSIT
      // ═══════════════════════════════════════════════════════════════════════
      if (payment.user) {
        const account = await Account.findOneAndUpdate(
          { ownerType: "User", ownerId: payment.user._id },
          { $inc: { balance: amount } },
          { new: true }
        );

        if (!account) {
          return res.status(404).json({ message: "Member account not found." });
        }

        const balanceBefore = account.balance - amount;
        const balanceAfter  = account.balance;

        await DepositReport.create({
          member:          payment.user._id,
          account:         account._id,
          amount,
          type:            "bank_transfer",
          reference:       payment.reference,
          description:     `Manual deposit approved (${payment.reference})`,
          status:          "approved",
          balanceBefore,
          balanceAfter,
          processedBy:     req.user._id,
          processedByRole: req.user.role?.name || "admin",
          processedAt:     new Date(),
          notes:           notes || "Approved by admin",
        });

        await CompanyLedger.create({
          type:        "deposit",
          direction:   "in",
          amount,
          relatedUser: payment.user._id,
          description: `Deposit received (${payment.reference})`,
          recordedBy:  req.user._id,
          meta: {
            reference: payment.reference,
            notes:     notes || "Approved by admin",
          },
        });

        const transaction = await Transaction.findOne({
          user:      payment.user._id,
          reference: payment.reference,
          type:      "deposit",
        });

        if (transaction) {
          transaction.status      = "successful";
          transaction.method      = "Bank Transfer";
          transaction.description = transaction.description
            || `Deposit approved by admin (${payment.reference})`;
          await transaction.save();
        }
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 3. ADMIN ACTION LOG
      // ═══════════════════════════════════════════════════════════════════════
      await AdminActionLog.create({
        admin:       req.user._id,
        adminRole:   req.user.role?.name || "admin",
        actionType:  "deposit_approve",
        targetUser:  payment.user?._id || null,
        targetModel: "Payment",
        targetId:    payment._id,
        description: `Approved deposit ${payment.reference}`,
        ipAddress:   req.ip,
        userAgent:   req.headers["user-agent"],
        status:      "success",
      });

      return res.json({
        success:    true,
        message:    "Deposit approved successfully",
        newBalance: payment.user?.account?.balance || 0,
      });

    } catch (error) {
      console.error("Approve deposit error:", error);
      res.status(500).json({ message: "Internal server error", error: error.message });
    }
  }
);

router.post(
  "/admin/deposits/:id/reject",
  ensureAdmin("process_deposits"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      if (!reason || !reason.trim()) {
        return res.status(400).json({
          message: "Rejection reason is required",
        });
      }

      const payment = await Payment.findById(id).populate({
        path: "user",
        populate: { path: "account" },
      });

      if (!payment) {
        return res.status(404).json({ message: "Deposit not found" });
      }

      // Prevent rejecting an already processed deposit
      if (payment.status === "success" || payment.status === "paid") {
        return res.status(400).json({
          message: "Approved deposits cannot be rejected",
        });
      }

      if (payment.status === "failed") {
        return res.status(400).json({
          message: "This deposit has already been rejected",
        });
      }

      // Update payment status
      payment.status = "failed";
      payment.paystackResponse = {
        ...(payment.paystackResponse || {}),
        adminNote:  reason,
        rejectedAt: new Date(),
        rejectedBy: req.user._id,
      };
      await payment.save();

      // Update linked transaction if exists
      const transaction = await Transaction.findOne({
        user:      payment.user?._id,
        reference: payment.reference,
        type:      "deposit",
      });

      if (transaction) {
        transaction.status      = "failed";
        transaction.method      = payment.paystackResponse?.channel || "Bank Transfer";
        transaction.description = transaction.description
          || `Deposit rejected by admin (${payment.reference})`;
        await transaction.save();
      }

      // Admin action log
      await AdminActionLog.create({
        admin:       req.user._id,
        adminRole:   req.user.role?.name || "admin",
        actionType:  "deposit_reject",
        targetUser:  payment.user?._id || null,
        targetModel: "Payment",
        targetId:    payment._id,
        description: `Rejected deposit ${payment.reference} — Reason: ${reason}`,
        ipAddress:   req.ip,
        userAgent:   req.headers["user-agent"],
        status:      "success",
      });

      return res.json({
        success: true,
        message: "Deposit rejected successfully",
      });

    } catch (error) {
      console.error("Reject deposit error:", error);
      res.status(500).json({ message: "Internal server error", error: error.message });
    }
  }
);





// ══════════════════════════════════════════════════════════════════════════════
// GET  /admin/kiddies-deposits          — render the management page
// POST /admin/kiddies-deposits/:id/approve
// POST /admin/kiddies-deposits/:id/reject
// ══════════════════════════════════════════════════════════════════════════════

// ─── GET: Render page ─────────────────────────────────────────────────────────
router.get(
  "/admin/kiddies-deposits",
  ensureAdmin("process_deposits"),
  async (req, res) => {
    try {
      // ── Fetch all KiddiesPayments (manual deposits only, paymentType: "deposit") ──
      const payments = await KiddiesPayment.find({ paymentType: { $in: ["deposit", "registration"] } })
        .populate({
          path: "kiddiesAccount",
          populate: { path: "account" },
        })
        .populate("parent", "firstName lastName email")
        .sort({ createdAt: -1 });

      // ── Shape data for the template ──
      const deposits = payments.map((p) => {
        const kiddies = p.kiddiesAccount;
        const parent  = p.parent;
        const acct    = kiddies?.account;
        const createdAt = new Date(p.createdAt);

        return {
          id:             p._id.toString(),
          reference:      p.reference,
          date:           createdAt.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }),
          time:           createdAt.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" }),
          childName:      kiddies ? `${kiddies.childFirstName} ${kiddies.childLastName}` : "—",
          accountID:      kiddies?.accountID || "—",
          parentName:     parent ? `${parent.firstName} ${parent.lastName}` : "—",
          parentEmail:    parent?.email || p.email,
          payeeName:      p.payeeName || null,
          paymentType:    p.paymentType,
          amount:         p.amount,
          currentBalance: Number(acct?.balance || 0),
          status:         p.status,                      // "pending" | "success" | "failed"
          verifiedAt:     p.verifiedAt || null,
        };
      });

      // ── Stats ──
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const stats = {
        totalDeposited: payments
          .filter((p) => p.status === "success")
          .reduce((sum, p) => sum + p.amount, 0),

        pendingCount: payments.filter((p) => p.status === "pending").length,

        approvedToday: payments.filter(
          (p) => p.status === "success" && p.verifiedAt && new Date(p.verifiedAt) >= today
        ).length,

        activeKiddiesAccounts: await KiddiesAccount.countDocuments({ status: "active" }),
      };

      return res.render("dashboard/admin/kiddies-deposits", { deposits, stats });

    } catch (err) {
      console.error("Kiddies deposits page error:", err);
      return res.redirect("/admin-dashboard");
    }
  }
);


// ─── POST: Approve ─────────────────────────────────────────────────────────────
router.post(
  "/admin/kiddies-deposits/:id/approve",
  ensureAdmin("process_deposits"),
  async (req, res) => {
    try {
      const { id }    = req.params;
      const { notes } = req.body;

      // ── 1. Atomically mark payment as success ──
      const payment = await KiddiesPayment.findOneAndUpdate(
        { _id: id, status: "pending" },
        { $set: { status: "success", verifiedAt: new Date() } },
        { new: true }
      ).populate({
        path: "kiddiesAccount",
        populate: { path: "account" },
      });

      if (!payment) {
        return res.status(400).json({
          status:  false,
          message: "Deposit already processed or not found.",
        });
      }

      const kiddiesAccount = payment.kiddiesAccount;
      const linkedAccount  = kiddiesAccount?.account;

      if (!linkedAccount) {
        await KiddiesPayment.findByIdAndUpdate(id, { $set: { status: "pending", verifiedAt: null } });
        return res.status(400).json({
          status:  false,
          message: "Linked savings account not found. Please contact support.",
        });
      }

      const isRegistration = payment.paymentType === "registration";

      // ── 2. Determine credit amount and registration fee ──
      let creditAmount    = payment.amount;
      let registrationFee = 0;

      if (isRegistration) {
        const settings  = await Settings.getSettings();
        registrationFee = Number(settings.registrationFees.kiddiesRegistrationFee || 0);
        creditAmount    = payment.amount - registrationFee;

        if (creditAmount <= 0) {
          await KiddiesPayment.findByIdAndUpdate(id, { $set: { status: "pending", verifiedAt: null } });
          return res.status(400).json({
            status:  false,
            message: `Invalid amounts: total ₦${payment.amount} is not greater than the registration fee ₦${registrationFee}.`,
          });
        }
      }

      // ── 3. Credit the child's savings account ──
      const updatedAccount = await Account.findByIdAndUpdate(
        linkedAccount._id,
        { $inc: { balance: creditAmount } },
        { new: true }
      );

      if (!updatedAccount) {
        await KiddiesPayment.findByIdAndUpdate(id, { $set: { status: "pending", verifiedAt: null } });
        return res.status(500).json({
          status:  false,
          message: "Failed to update account balance. Please try again.",
        });
      }

      // ── 4. Mark registrationStatus as paid on the kiddies account ──
      if (isRegistration) {
        await KiddiesAccount.findByIdAndUpdate(kiddiesAccount._id, {
          $set: { registrationStatus: "paid" },
        });
      }

      // ── 5. KiddiesTransaction — deposit only (credit amount) ──
      await KiddiesTransaction.create({
        kiddiesAccount: kiddiesAccount._id,
        parent:         payment.parent,
        type:           "deposit",
        amount:         creditAmount,
        balanceAfter:   updatedAccount.balance,
        description:    isRegistration
          ? `Initial Deposit — Registration Approved by Admin (${kiddiesAccount.accountID})${payment.payeeName ? ` | Payer: ${payment.payeeName}` : ""}`
          : `Manual Deposit — Approved by Admin (${kiddiesAccount.accountID})${payment.payeeName ? ` | Payer: ${payment.payeeName}` : ""}`,
        reference:      payment.reference,
        status:         "completed",
        paymentMethod:  "cooperative",
      });

      // ── 6. Separate Payment record for registration fee ──
      if (isRegistration && registrationFee > 0) {
        await Payment.create({
          user:        payment.parent,
          email:       payment.email,
          amount:      registrationFee,
          reference:   `${payment.reference}-REG-FEE`,
          payeeName:   payment.payeeName || null,
          paymentType: "registration_fee",
          status:      "success",
          paystackResponse: {
            method:     "Manual Transfer",
            note:       "Registration fee extracted on admin approval",
            accountID:  kiddiesAccount.accountID,
            approvedBy: req.user._id,
            approvedAt: new Date(),
          },
        });
      }

      // ── 7. Company Ledger: IN — initial deposit / top-up into kiddies account ──
      await CompanyLedger.create({
        type:        "kiddies_deposit_approve",
        direction:   "in",
        amount:      creditAmount,
        relatedUser: payment.parent || null,
        description: isRegistration
          ? `Kiddies initial deposit — ${kiddiesAccount.accountID} (${payment.reference})${payment.payeeName ? ` | Payer: ${payment.payeeName}` : ""}`
          : `Kiddies deposit received — ${kiddiesAccount.accountID} (${payment.reference})${payment.payeeName ? ` | Payer: ${payment.payeeName}` : ""}`,
        recordedBy:  req.user._id,
        meta: {
          reference:    payment.reference,
          accountID:    kiddiesAccount.accountID,
          payeeName:    payment.payeeName || null,
          notes:        notes || "Approved by admin",
          balanceAfter: updatedAccount.balance,
          paymentType:  payment.paymentType,
        },
      });

      // ── 8. Company Ledger: IN — registration fee as separate income entry ──
      if (isRegistration && registrationFee > 0) {
        await CompanyLedger.create({
          type:        "registration_fee",
          direction:   "in",
          amount:      registrationFee,
          relatedUser: payment.parent || null,
          description: `Kiddies registration fee — ${kiddiesAccount.accountID} (${payment.reference})`,
          recordedBy:  req.user._id,
          meta: {
            reference:  payment.reference,
            accountID:  kiddiesAccount.accountID,
            payeeName:  payment.payeeName || null,
          },
        });
      }

      // ── 9. Admin action log ──
      await AdminActionLog.create({
        admin:       req.user._id,
        adminRole:   req.user.role?.name || "admin",
        actionType:  "kiddies_deposit_approve",
        targetUser:  payment.parent || null,
        targetModel: "KiddiesPayment",
        targetId:    payment._id,
        description: `Approved kiddies ${isRegistration ? "registration" : "deposit"} ${payment.reference} — ₦${creditAmount.toLocaleString()} credited → ${kiddiesAccount.accountID}${isRegistration ? ` | Fee: ₦${registrationFee.toLocaleString()}` : ""}`,
        ipAddress:   req.ip,
        userAgent:   req.headers["user-agent"],
        status:      "success",
        meta: {
          notes:          notes || "Approved by admin",
          paymentType:    payment.paymentType,
          creditAmount,
          registrationFee,
        },
      });

      console.log(
        `✅ Kiddies ${isRegistration ? "registration" : "deposit"} approved: ₦${creditAmount} credited → ${kiddiesAccount.accountID}${isRegistration ? ` | Fee: ₦${registrationFee}` : ""} | Ref: ${payment.reference} | Admin: ${req.user.email}`
      );

      return res.json({
        status:     true,
        message:    `Kiddies ${isRegistration ? "registration" : "deposit"} approved successfully.`,
        newBalance: updatedAccount.balance,
      });

    } catch (err) {
      console.error("Kiddies deposit approve error:", err);
      return res.status(500).json({ status: false, message: "Server error. Please try again." });
    }
  }
);


// ─── POST: Reject ──────────────────────────────────────────────────────────────
router.post(
  "/admin/kiddies-deposits/:id/reject",
  ensureAdmin("process_deposits"),
  async (req, res) => {
    try {
      const { id }     = req.params;
      const { reason } = req.body;

      if (!reason?.trim()) {
        return res.status(400).json({
          status:  false,
          message: "A rejection reason is required.",
        });
      }

      // ── 1. Atomically mark payment as failed ──
      const payment = await KiddiesPayment.findOneAndUpdate(
        { _id: id, status: "pending" },
        {
          $set: {
            status:     "failed",
            verifiedAt: new Date(),
            "paystackResponse.rejectionReason": reason,
            "paystackResponse.rejectedAt":      new Date(),
            "paystackResponse.rejectedBy":      req.user._id,
          },
        },
        { new: true }
      ).populate({
        path: "kiddiesAccount",
        populate: { path: "account" },
      });

      if (!payment) {
        return res.status(400).json({
          status:  false,
          message: "Deposit already processed or not found.",
        });
      }

      const kiddiesAccount = payment.kiddiesAccount;

      // ── 2. Mark any pending KiddiesTransaction for this reference as failed ──
      await KiddiesTransaction.findOneAndUpdate(
        {
          kiddiesAccount: kiddiesAccount._id,
          reference:      payment.reference,
          status:         "pending",
        },
        {
          $set: {
            status:      "failed",
            description: `${payment.paymentType === "registration" ? "Registration deposit" : "Deposit"} rejected by admin — ${reason}`,
          },
        }
      );

      // ── 3. Admin action log ──
      await AdminActionLog.create({
        admin:       req.user._id,
        adminRole:   req.user.role?.name || "admin",
        actionType:  "kiddies_deposit_reject",
        targetUser:  payment.parent || null,
        targetModel: "KiddiesPayment",
        targetId:    payment._id,
        description: `Rejected kiddies ${payment.paymentType} ${payment.reference} — Reason: ${reason}`,
        ipAddress:   req.ip,
        userAgent:   req.headers["user-agent"],
        status:      "success",
        meta:        { reason, paymentType: payment.paymentType },
      });

      console.log(
        `❌ Kiddies ${payment.paymentType} rejected: ${payment.reference} | Reason: ${reason} | Admin: ${req.user.email}`
      );

      return res.json({
        status:  true,
        message: "Kiddies deposit rejected successfully.",
      });

    } catch (err) {
      console.error("Kiddies deposit reject error:", err);
      return res.status(500).json({ status: false, message: "Server error. Please try again." });
    }
  }
);
// ADMIN WITHDRWALS MANAGEMENT 


/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN — WITHDRAWAL MANAGEMENT ROUTES
   GET  /admin/manage-withdrawals   — render the management page
   POST /admin/withdrawals/:id/approve — approve + ledger + log
   POST /admin/withdrawals/:id/reject  — reject + log
═══════════════════════════════════════════════════════════════════════════ */

/* ─── GET: render withdrawal management page ──────────────────────────── */
router.get("/admin/manage-withdrawals", ensureAdmin("view_withdrawals"), async (req, res) => {
  try {
    /* Fetch all non-success withdrawals (pending, processing, failed) */
    const withdrawals = await Withdrawal.find({ status: { $ne: "success" } })
      .populate({
        path: "user",
        select: "firstName lastName membershipID email phone account status",
        populate: { path: "account", select: "balance" },
      })
      .sort({ createdAt: -1 });

    const withdrawalData = withdrawals.map((w) => {
      const dateObj = new Date(w.createdAt);
      const memberName = w.user
        ? `${w.user.firstName} ${w.user.lastName}`
        : "N/A";

      /* Map DB status to display status */
      const displayStatus =
        w.status === "success"    ? "approved"   :
        w.status === "failed"     ? "rejected"   :
        w.status === "processing" ? "processing" : "pending";

      /* Withdrawal type label */
      const typeLabel =
        w.type === "ondemand" ? "On-demand" :
        w.type === "regular"  ? "Regular"   : w.type;

      return {
        id:              w._id,
        reference:       w.reference,
        date:            dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        time:            dateObj.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
        memberName,
        memberId:        w.user?.membershipID || "N/A",
        memberEmail:     w.user?.email        || "N/A",
        memberPhone:     w.user?.phone        || "N/A",

        /* ── Financial fields ── */
        amount:          w.amount,          // gross requested
        penaltyRate:     w.penaltyRate  || 0,
        penaltyAmount:   w.penaltyAmount || 0,
        netAmount:       w.netAmount    || w.amount, // what admin actually pays out
        phase1Amount:    w.phase1Amount || w.netAmount || w.amount,
        phase2Amount:    w.phase2Amount || 0,
        payoutType:      w.payoutType   || "immediate",

        /* ── Bank & account ── */
        bankName:        w.bankName,
        accountName:     w.accountName,
        accountNumber:   w.accountNumber,
        method:          "Bank Transfer",
        type:            w.type     || "normal",
        typeLabel,
        status:          displayStatus,
        balance:         w.user?.account?.balance || 0,

        /* ── Flags ── */
        triggeredDeactivation: w.triggeredDeactivation || false,
        notes:           w.notes || "",
      };
    });

    /* ── Stats ── */
    const pendingRequests = withdrawals.filter(
      (w) => w.status === "pending" || w.status === "processing"
    ).length;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [approvedToday, rejectedToday, totalAmountAgg] = await Promise.all([
      Withdrawal.countDocuments({ status: "success",  createdAt: { $gte: today } }),
      Withdrawal.countDocuments({ status: "failed",   createdAt: { $gte: today } }),
      Withdrawal.aggregate([
        { $match: { status: "success" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);

    res.render("dashboard/admin/withdrawal", {
      admin: req.user,
      withdrawals: withdrawalData,
      stats: {
        pendingRequests,
        approvedToday,
        rejectedToday,
        totalAmount: totalAmountAgg[0]?.total || 0,
      },
    });
  } catch (err) {
    console.error("[Admin] Withdrawal fetch error:", err);
    res.status(500).send("Internal Server Error");
  }
});

/* ─── POST: approve a withdrawal ─────────────────────────────────────── */
router.post(
  "/admin/withdrawals/:id/approve",
  ensureAdmin("manage_withdrawals"),
  async (req, res) => {
    try {
      const { notes = "" } = req.body;
      const adminUser = req.user;

      /* ── 1. ATOMIC STATUS TRANSITION ────────────────────────────────────
         findOneAndUpdate with a status filter as the condition.
         If two admins click Approve simultaneously only one will match
         { status: $in ["pending","processing"] } — the second gets null
         and is rejected before any side-effects run.
      ──────────────────────────────────────────────────────────────────── */
      const withdrawal = await Withdrawal.findOneAndUpdate(
        {
          _id:    req.params.id,
          status: { $in: ["pending", "processing"] },  // only claim if still actionable
        },
        {
          status:      "success",
          processedAt: new Date(),
          ...(notes && { notes }),
        },
        { new: true }                                   // return the updated doc
      ).populate({
        path: "user",
        select: "firstName lastName membershipID email account status",
        populate: { path: "account", select: "balance" },
      });

      if (!withdrawal) {
        /* Either not found or already approved/rejected by another admin */
        return res.status(400).json({
          success: false,
          message: "Withdrawal not found or has already been processed",
        });
      }

      const isOnDemand    = withdrawal.type === "ondemand";
      const grossAmount   = Number(withdrawal.amount);
      const penaltyRate   = Number(withdrawal.penaltyRate   || 0);
      const penaltyAmount = Number(withdrawal.penaltyAmount || 0);
      const netAmount     = Number(withdrawal.netAmount     || grossAmount);
      const phase1Amount  = Number(withdrawal.phase1Amount  || netAmount);
      const phase2Amount  = Number(withdrawal.phase2Amount  || 0);
      const payoutType    = withdrawal.payoutType || "immediate";
      const memberName    = withdrawal.user
        ? `${withdrawal.user.firstName} ${withdrawal.user.lastName}`
        : "Unknown";
      const currentBalance = Number(withdrawal.user?.account?.balance || 0);
      /* The gross amount was already deducted from the member's account at request time.
         currentBalance = balance AFTER deduction.
         balanceBefore  = what the member had BEFORE the withdrawal request.
         balanceAfter   = currentBalance (unchanged by this approval — money left at request). */
      const balanceBefore = currentBalance + grossAmount;
      const balanceAfter  = currentBalance;

      /* ── 2. Update related transaction to success (idempotent guard) ── */
      await Transaction.updateOne(
        { reference: withdrawal.reference, status: { $ne: "success" } },
        { status: "success" }
      );

      /* ── 3. DEACTIVATE MEMBER ACCOUNT IF FLAGGED ────────────────────────
         Deactivation is deferred to here — account stays active while
         pending so the member can still log in. Locked on admin approval.
      ──────────────────────────────────────────────────────────────────── */
      if (withdrawal.triggeredDeactivation) {
        await User.findByIdAndUpdate(withdrawal.user._id, { status: "deactivated" });
        console.log(
          `[Admin] Deactivated user ${withdrawal.user._id} on withdrawal approval | ` +
          `ref=${withdrawal.reference} | approvedBy=${adminUser.firstName} ${adminUser.lastName}`
        );
      }

      /* ── 4. CACHE TRANSACTION (single DB hit for both ledger entries) ───
         Both CompanyLedger entries need the transaction _id.
         Fetching once here avoids two extra round-trips to MongoDB.
      ──────────────────────────────────────────────────────────────────── */
      const relatedTxn = await Transaction.findOne({ reference: withdrawal.reference });

      /* ── 5. COMPANY LEDGER ENTRIES ──────────────────────────────────────
         5a — outgoing net payout (money leaving cooperative to member)
         5b — fee income (on-demand only, money earned by cooperative)
         Recorded at APPROVAL time. Balance was already debited at request.
      ──────────────────────────────────────────────────────────────────── */

      // 5a — outgoing payout
      await CompanyLedger.create({
        type:               isOnDemand ? "forced_withdrawal" : "withdrawal",
        amount:             phase1Amount,
        direction:          "out",
        relatedUser:        withdrawal.user._id,
        relatedTransaction: relatedTxn?._id,
        description:        isOnDemand
          ? `On-demand withdrawal approved for ${memberName} — ` +
            `net ₦${phase1Amount.toLocaleString()} after ${penaltyRate}% fee on ₦${grossAmount.toLocaleString()} gross`
          : `Regular withdrawal approved for ${memberName} — ₦${grossAmount.toLocaleString()}`,
        recordedBy: adminUser._id,
        meta: {
          grossAmount,
          penaltyRate,
          penaltyAmount,
          netAmount,
          payoutType,
          phase1Amount,
          phase2Amount,
          approvedBy:     adminUser._id,
          approvedByName: `${adminUser.firstName} ${adminUser.lastName}`,
          withdrawalRef:  withdrawal.reference,
        },
      });

      // 5b — fee income (on-demand only)
      if (isOnDemand && penaltyAmount > 0) {
        await CompanyLedger.create({
          type:               "penalty_income",
          amount:             penaltyAmount,
          direction:          "in",
          relatedUser:        withdrawal.user._id,
          relatedTransaction: relatedTxn?._id,
          description:
            `On-demand withdrawal fee (${penaltyRate}%) from ${memberName} — ` +
            `₦${penaltyAmount.toLocaleString()} on ₦${grossAmount.toLocaleString()} gross`,
          recordedBy: adminUser._id,
          meta: {
            grossAmount,
            penaltyRate,
            penaltyAmount,
            netAmount,
            withdrawalRef: withdrawal.reference,
            approvedBy:    adminUser._id,
          },
        });

        /* 5c — ExtraCharge record (on-demand fee audit trail per member) */
        await ExtraCharge.create({
          member:     withdrawal.user._id,
          chargeType: "forceful-withdrawal",
          amount:     penaltyAmount,
          reason:
            `On-demand withdrawal fee ${penaltyRate}% on ₦${grossAmount.toLocaleString()} — ` +
            `net ₦${netAmount.toLocaleString()} | ref: ${withdrawal.reference}`,
          status: "paid",
          paidAt: new Date(),
        });
      }

      /* ── 6. WITHDRAWAL REPORT ── */
      await WithdrawalReport.create({
        member:         withdrawal.user._id,
        account:        withdrawal.user.account?._id,
        amount:         grossAmount,
        fee:            penaltyAmount,
        netAmount,
        type:           "bank_transfer",
        reference:      withdrawal.reference,
        description:    isOnDemand
          ? `On-demand withdrawal — gross ₦${grossAmount.toLocaleString()} | fee ${penaltyRate}% = ₦${penaltyAmount.toLocaleString()} | net ₦${netAmount.toLocaleString()}`
          : `Regular withdrawal — ₦${grossAmount.toLocaleString()}`,
        bankDetails: {
          bankName:      withdrawal.bankName,
          accountNumber: withdrawal.accountNumber,
          accountName:   withdrawal.accountName,
        },
        status:          "approved",
        balanceBefore,   // currentBalance + grossAmount — true pre-request balance
        balanceAfter,
        requestedBy:     withdrawal.user._id,
        approvedBy:      adminUser._id,
        approvedAt:      new Date(),
        approvedByRole:  adminUser.role?.name || "admin",
        notes,
      });

      /* ── 7. ADMIN ACTION LOG ── */
      await AdminActionLog.create({
        admin:       adminUser._id,
        adminRole:   adminUser.role?.name || "admin",
        actionType:  "withdrawal_approve",
        targetUser:  withdrawal.user._id,
        targetModel: "Withdrawal",
        targetId:    withdrawal._id,
        description:
          `Admin ${adminUser.firstName} ${adminUser.lastName} approved withdrawal ` +
          `₦${grossAmount.toLocaleString()} (ref: ${withdrawal.reference}) ` +
          `for member ${memberName} (${withdrawal.user.membershipID}) — ` +
          `type: ${withdrawal.type} | net payout: ₦${netAmount.toLocaleString()}` +
          (penaltyAmount > 0 ? ` | fee: ₦${penaltyAmount.toLocaleString()} (${penaltyRate}%)` : "") +
          (withdrawal.triggeredDeactivation ? " | account deactivated (balance below ₦10,000)" : ""),
        changes: {
          before: { status: "pending" },
          after: {
            status:          "success",
            processedAt:     withdrawal.processedAt,
            userDeactivated: withdrawal.triggeredDeactivation || false,
          },
          financial: {
            grossAmount, penaltyRate, penaltyAmount, netAmount, payoutType,
            phase1Amount, phase2Amount,
          },
        },
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        status: "success",
      });

      console.log(
        `[Admin] Withdrawal approved: ref=${withdrawal.reference} | ` +
        `member=${memberName} | gross=₦${grossAmount} | fee=₦${penaltyAmount} | net=₦${netAmount}` +
        (withdrawal.triggeredDeactivation ? " | account deactivated" : "") +
        ` | approvedBy=${adminUser.firstName} ${adminUser.lastName}`
      );

      return res.json({
        success:     true,
        deactivated: withdrawal.triggeredDeactivation || false,
        message:     withdrawal.triggeredDeactivation
          ? "Withdrawal approved. Member account has been deactivated (balance below ₦10,000)."
          : "Withdrawal approved successfully",
        status:      "approved",
        newBalance:  balanceAfter,
      });

    } catch (err) {
      console.error("[Admin] Withdrawal approval error:", err);
      return res.status(500).json({ success: false, message: "Failed to approve withdrawal" });
    }
  }
);

/* ─── POST: reject a withdrawal ──────────────────────────────────────── */
router.post(
  "/admin/withdrawals/:id/reject",
  ensureAdmin("manage_withdrawals"),
  async (req, res) => {
    try {
      const { reason = "", notes = "" } = req.body;
      const adminUser = req.user;

      if (!reason) {
        return res.status(400).json({ success: false, message: "Rejection reason is required" });
      }

      /* ── 1. Load withdrawal with user + account ── */
      const withdrawal = await Withdrawal.findById(req.params.id).populate({
        path: "user",
        select: "firstName lastName membershipID email account status",
        populate: { path: "account", select: "balance" },
      });

      if (!withdrawal) {
        return res.status(404).json({ success: false, message: "Withdrawal not found" });
      }

      if (withdrawal.status === "success") {
        return res.status(400).json({ success: false, message: "Cannot reject an already approved withdrawal" });
      }

      /* ── Build rejection note early — used in the atomic update below ── */
      const rejectionNote = `${reason}${notes ? " — " + notes : ""}`;

      /* ── ATOMIC STATUS GUARD ─────────────────────────────────────────────
         Claim the withdrawal atomically before touching money.
         Two admins clicking Reject simultaneously: only one gets a non-null
         result — the second hits "already processed" and stops here,
         preventing a double refund.
      ──────────────────────────────────────────────────────────────────── */
      const claimed = await Withdrawal.findOneAndUpdate(
        {
          _id:    withdrawal._id,
          status: { $in: ["pending", "processing"] },  // only claim if still actionable
        },
        {
          status:      "failed",
          processedAt: new Date(),
          notes:       rejectionNote,
        },
        { new: true }
      );

      if (!claimed) {
        return res.status(400).json({
          success: false,
          message: "Withdrawal has already been processed",
        });
      }

      const isOnDemand    = withdrawal.type === "ondemand";
      const grossAmount   = Number(withdrawal.amount);
      const penaltyAmount = Number(withdrawal.penaltyAmount || 0);
      const penaltyRate   = Number(withdrawal.penaltyRate   || 0);
      const netAmount     = Number(withdrawal.netAmount     || grossAmount);
      const memberName    = withdrawal.user
        ? `${withdrawal.user.firstName} ${withdrawal.user.lastName}`
        : "Unknown";

      /*
       * BALANCE ACCURACY FIX
       * ─────────────────────
       * The full gross amount was deducted from the account at request time.
       * So right now: account.balance = balance AFTER the deduction.
       *
       * balanceBefore = what the member had BEFORE they requested the withdrawal
       *               = current balance + grossAmount
       * balanceAfter  = what they will have AFTER refund
       *               = current balance + grossAmount   (same — we're restoring them)
       */
      const currentBalance = Number(withdrawal.user?.account?.balance || 0);
      const balanceBefore  = currentBalance + grossAmount;  // true original balance
      const balanceAfter   = balanceBefore;                 // restored to original after refund

      /* ── 2. Refund gross amount back to member's account ── */
      if (!withdrawal.user?.account?._id) {
        throw new Error(`User account not found for withdrawal ${withdrawal._id} — cannot refund`);
      }

      await Account.findByIdAndUpdate(
        withdrawal.user.account._id,
        { $inc: { balance: grossAmount } }
      );

      /* ── 3. Reactivate user if this withdrawal triggered deactivation ──
              (balance is now restored, so the below-10k rule no longer applies)
      ── */
      if (withdrawal.triggeredDeactivation) {
        await User.findByIdAndUpdate(withdrawal.user._id, { status: "active" });
        console.log(`[Admin] User ${withdrawal.user._id} reactivated after withdrawal rejection`);
      }

      /* ── 5. Update related transaction ── */
      await Transaction.findOneAndUpdate(
        { reference: withdrawal.reference },
        { status: "failed" }
      );

      /* ═══════════════════════════════════════════════════════════════════
         6. REVERSE COMPANY LEDGER ENTRIES (on-demand only)
            The ledger entries for this withdrawal may already exist if
            they were created at request time. Whether they exist or not,
            we create explicit reversal/correction entries so the ledger
            remains a complete, accurate audit trail.

            6a — Reverse the outgoing payout entry:
                 Create an "in" entry to cancel the money-out record.
            6b — Reverse the fee income entry:
                 Create an "out" entry to cancel the fee earned.

            We also soft-delete any existing pending ledger entries tied
            to this withdrawal reference by marking them reversed in meta.
      ═══════════════════════════════════════════════════════════════════ */
      if (isOnDemand) {

        /* Find existing ledger entries linked to this withdrawal reference */
        const existingEntries = await CompanyLedger.find({
          relatedUser: withdrawal.user._id,
          "meta.withdrawalRef": withdrawal.reference,
        });

        /* Soft-mark each existing entry as reversed */
        if (existingEntries.length > 0) {
          await CompanyLedger.updateMany(
            {
              relatedUser: withdrawal.user._id,
              "meta.withdrawalRef": withdrawal.reference,
            },
            {
              $set: {
                "meta.reversed":     true,
                "meta.reversedAt":   new Date(),
                "meta.reversedBy":   adminUser._id,
                "meta.reversalNote": `Withdrawal rejected by admin: ${rejectionNote}`,
              },
            }
          );
        }

        /* 6a — Reversal entry for the outgoing net payout */
        await CompanyLedger.create({
          type:        "forced_withdrawal",    // opposite direction = reversal
          amount:      netAmount,
          direction:   "in",                  // money coming BACK in (payout never happened)
          relatedUser: withdrawal.user._id,
          description:
            `REVERSAL — On-demand withdrawal payout reversed for ${memberName}. ` +
            `₦${netAmount.toLocaleString()} net payout cancelled (ref: ${withdrawal.reference}). ` +
            `Reason: ${rejectionNote}`,
          recordedBy: adminUser._id,
          meta: {
            grossAmount,
            penaltyRate,
            penaltyAmount,
            netAmount,
            withdrawalRef:  withdrawal.reference,
            reversalOf:     "payout",
            rejectedBy:     adminUser._id,
            rejectionReason: rejectionNote,
          },
        });

        /* 6b — Reversal entry for the fee income (cooperative gives fee back) */
        if (penaltyAmount > 0) {
          await CompanyLedger.create({
            type:        "penalty_income",     // same type, opposite direction = reversal
            amount:      penaltyAmount,
            direction:   "out",               // fee income is reversed / returned
            relatedUser: withdrawal.user._id,
            description:
              `REVERSAL — On-demand withdrawal fee income reversed for ${memberName}. ` +
              `₦${penaltyAmount.toLocaleString()} fee (${penaltyRate}%) cancelled ` +
              `(ref: ${withdrawal.reference}). Reason: ${rejectionNote}`,
            recordedBy: adminUser._id,
            meta: {
              grossAmount,
              penaltyRate,
              penaltyAmount,
              withdrawalRef:   withdrawal.reference,
              reversalOf:      "fee_income",
              rejectedBy:      adminUser._id,
              rejectionReason: rejectionNote,
            },
          });
        }
      }

      /* ═══════════════════════════════════════════════════════════════════
         7. REVERSE EXTRA CHARGE RECORD (on-demand only)
            The ExtraCharge was recorded as "paid" at approval time.
            On rejection, the fee is cancelled — mark it "reversed" using
            the new enum value added to the ExtraCharge model.
      ═══════════════════════════════════════════════════════════════════ */
      if (isOnDemand && penaltyAmount > 0) {
        await ExtraCharge.findOneAndUpdate(
          {
            member:     withdrawal.user._id,
            chargeType: "forceful-withdrawal",
            status:     "paid",
            reason:     { $regex: withdrawal.reference },
          },
          {
            $set: {
              status:         "reversed",
              reversedAt:     new Date(),
              reversedBy:     adminUser._id,
              reversalReason:
                `Withdrawal rejected by admin ${adminUser.firstName} ${adminUser.lastName}. ` +
                `Ref: ${withdrawal.reference}. Reason: ${rejectionNote}`,
              paidAt:         null,
            },
          }
        );
      }

      /* ── 8. Withdrawal Report ── */
      await WithdrawalReport.create({
        member:         withdrawal.user._id,
        account:        withdrawal.user.account?._id,
        amount:         grossAmount,
        fee:            0,           // fee not collected — reversed
        netAmount:      0,           // nothing paid out
        type:           "bank_transfer",
        reference:      withdrawal.reference,
        description:
          `Rejected withdrawal — ₦${grossAmount.toLocaleString()} refunded to member.` +
          (isOnDemand && penaltyAmount > 0
            ? ` Fee of ₦${penaltyAmount.toLocaleString()} (${penaltyRate}%) reversed.`
            : ""),
        bankDetails: {
          bankName:      withdrawal.bankName,
          accountNumber: withdrawal.accountNumber,
          accountName:   withdrawal.accountName,
        },
        status:          "rejected",
        balanceBefore,   // ✅ true original balance (before the withdrawal request)
        balanceAfter,    // ✅ balance after refund (= balanceBefore — fully restored)
        requestedBy:     withdrawal.user._id,
        rejectedBy:      adminUser._id,
        rejectedAt:      new Date(),
        rejectionReason: rejectionNote,
        notes,
      });

      /* ── 9. Admin Action Log ── */
      await AdminActionLog.create({
        admin:       adminUser._id,
        adminRole:   adminUser.role?.name || "admin",
        actionType:  "withdrawal_reject",
        targetUser:  withdrawal.user._id,
        targetModel: "Withdrawal",
        targetId:    withdrawal._id,
        description:
          `Admin ${adminUser.firstName} ${adminUser.lastName} rejected withdrawal ` +
          `₦${grossAmount.toLocaleString()} (ref: ${withdrawal.reference}) ` +
          `for member ${memberName} (${withdrawal.user.membershipID}). ` +
          `Reason: ${reason}. ` +
          `₦${grossAmount.toLocaleString()} refunded to account.` +
          (isOnDemand && penaltyAmount > 0
            ? ` ₦${penaltyAmount.toLocaleString()} fee income reversed.`
            : "") +
          (withdrawal.triggeredDeactivation ? " Account reactivated." : ""),
        changes: {
          before: {
            status:  "pending",
            balance: currentBalance,
          },
          after: {
            status:         "failed",
            processedAt:    claimed.processedAt,
            balance:        balanceAfter,
          },
          refunded:        grossAmount,
          feeReversed:     isOnDemand ? penaltyAmount : 0,
          ledgerReversed:  isOnDemand,
          userReactivated: withdrawal.triggeredDeactivation || false,
          reason,
        },
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        status: "success",
      });

      console.log(
        `[Admin] Withdrawal rejected: ref=${withdrawal.reference} | ` +
        `member=${memberName} | ₦${grossAmount} refunded` +
        (isOnDemand && penaltyAmount > 0 ? ` | ₦${penaltyAmount} fee reversed` : "") +
        (withdrawal.triggeredDeactivation ? " | account reactivated" : "") +
        ` | rejectedBy=${adminUser.firstName} ${adminUser.lastName} | reason=${reason}`
      );

      return res.json({
        success:    true,
        message:    "Withdrawal rejected, balance refunded" +
                    (isOnDemand && penaltyAmount > 0 ? " and fee income reversed" : "") +
                    (withdrawal.triggeredDeactivation ? ". Member account reactivated." : "."),
        status:     "rejected",
        newBalance: balanceAfter,
        reactivated: withdrawal.triggeredDeactivation || false,
      });

    } catch (err) {
      console.error("[Admin] Withdrawal rejection error:", err);
      return res.status(500).json({ success: false, message: "Failed to reject withdrawal" });
    }
  }
);

// ENDS HERE 


// EXTRA CHARGES SECTION
router.get("/admin/manage-extra-charges", ensureAdmin("view_extracharges"), async (req, res) => {
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


















// SETTINGS ROUTE 
router.get("/admin/settings", ensureAdmin("manage_settings"), async (req, res) => {
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




// ─────────────────────────────────────────────
// Update Registration Fees
// ─────────────────────────────────────────────
router.post("/admin/settings/registration-fees", ensureAdmin("manage_settings"), async (req, res) => {
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


// ─────────────────────────────────────────────
// Update Kiddies Account Settings
// ─────────────────────────────────────────────
router.post("/admin/settings/kiddies-settings", ensureAdmin("manage_settings"), async (req, res) => {
  try {
    const {
      minAge,
      maxAge,
      upgradeAge,
      monthlyFee,
      upgradeFee,
      interestRate,
      notificationDays,
    } = req.body;

    const settings = await Settings.getSettings();

    settings.kiddiesSettings.minAge = minAge;
    settings.kiddiesSettings.maxAge = maxAge;
    settings.kiddiesSettings.upgradeAge = upgradeAge;
    settings.kiddiesSettings.monthlyMaintenanceFee = monthlyFee;
    settings.kiddiesSettings.upgradeProcessingFee = upgradeFee;
    settings.kiddiesSettings.kiddiesInterestRate = interestRate;
    settings.kiddiesSettings.autoUpgradeNotificationDays =
      [30, 60, 90].includes(Number(notificationDays)) ? Number(notificationDays) : 60;

    await settings.save();

    res.json({ success: true, message: "Kiddies settings updated successfully!" });
  } catch (err) {
    console.error("Error updating kiddies settings:", err);
    res.status(500).json({ success: false, message: "Failed to update kiddies settings" });
  }
});


// ─────────────────────────────────────────────
// Update Additional Fees & Charges
// ─────────────────────────────────────────────
router.post("/admin/settings/other-fees", ensureAdmin("manage_settings"), async (req, res) => {
  try {
    const { roiOperating } = req.body;

    const settings = await Settings.getSettings();

    settings.otherFees.roiOperatingCharge = roiOperating;

    await settings.save();

    res.json({ success: true, message: "Additional fees updated successfully!" });
  } catch (err) {
    console.error("Error updating other fees:", err);
    res.status(500).json({ success: false, message: "Failed to update additional fees" });
  }
});


// ─────────────────────────────────────────────
// Update Company Bank Account
// ─────────────────────────────────────────────
router.post("/admin/settings/company-account", ensureAdmin("manage_settings"), async (req, res) => {
  try {
    const { bankName, accountNumber, accountName } = req.body;

    if (!bankName || !accountNumber || !accountName) {
      return res.status(400).json({ success: false, message: "All account fields are required" });
    }

    const settings = await Settings.getSettings();

    settings.companyAccount.bankName = bankName.trim();
    settings.companyAccount.accountNumber = accountNumber.trim();
    settings.companyAccount.accountName = accountName.trim();

    await settings.save();

    res.json({ success: true, message: "Company account details updated successfully!" });
  } catch (err) {
    console.error("Error updating company account:", err);
    res.status(500).json({ success: false, message: "Failed to update company account details" });
  }
});


// ─────────────────────────────────────────────
// Toggle Maintenance Mode
// ─────────────────────────────────────────────
router.post("/admin/settings/maintenance-mode", ensureAdmin("manage_settings"), async (req, res) => {
  try {
    const { enabled, message } = req.body;

    const settings = await Settings.getSettings();

    settings.maintenanceMode.enabled = Boolean(enabled);

    if (message !== undefined) {
      settings.maintenanceMode.message = message.trim();
    }

    if (Boolean(enabled)) {
      settings.maintenanceMode.enabledAt = new Date();
      settings.maintenanceMode.enabledBy = req.user?._id || null;
    } else {
      settings.maintenanceMode.enabledAt = null;
      settings.maintenanceMode.enabledBy = null;
    }

    await settings.save();

    const status = Boolean(enabled) ? "enabled" : "disabled";
    res.json({ success: true, message: `Maintenance mode ${status} successfully!` });
  } catch (err) {
    console.error("Error toggling maintenance mode:", err);
    res.status(500).json({ success: false, message: "Failed to update maintenance mode" });
  }
});






// Exchange rate constant
const EXCHANGE_RATE = 1500;

// ============================================
// GET: Manage Subscriptions Page
// ============================================
router.get(
  '/manage-subscriptions',
  ensureAdmin("view_subscriptions"),
  async (req, res) => {
    try {
      // Fetch all services with their current status
      const services = await Service.find({ isActive: true }).sort({ name: 1 });
      console.log("Fetched services:", services);
      
      // Fetch subscription statuses
      const subscriptionStatuses = await SubscriptionStatus.find()
        .populate('service')
        .populate({
          path: 'lastPayment',
          select: 'paymentDate amount currency transactionReference status'
        });

      // Fetch recent payment history (last 20 payments)
      const paymentHistory = await PaymentHistory.find()
        .populate('service')
        .populate('recordedBy', 'firstName lastName email')
        .sort({ paymentDate: -1 })
        .limit(20);

      // Calculate summary statistics
      const totalServices = services.length;
      const activeServices = subscriptionStatuses.filter(s => s.currentStatus === 'Active').length;
      const expiringServices = subscriptionStatuses.filter(s => s.currentStatus === 'Expiring Soon').length;
      const expiredServices = subscriptionStatuses.filter(s => s.currentStatus === 'Expired').length;

      // Calculate total spend
      const totalSpend = await PaymentHistory.aggregate([
        { $match: { status: 'Paid' } },
        { $group: { _id: null, total: { $sum: '$amountInNaira' } } }
      ]);

      // Find next renewal date
      const nextRenewal = subscriptionStatuses.reduce((earliest, current) => {
        if (!earliest || current.nextRenewalDate < earliest.nextRenewalDate) {
          return current;
        }
        return earliest;
      }, null);

      // Calculate days until next renewal
      let daysUntilRenewal = 0;
      if (nextRenewal && nextRenewal.nextRenewalDate) {
        const today = new Date();
        const diffTime = nextRenewal.nextRenewalDate - today;
        daysUntilRenewal = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      }

      // Prepare service cards data with status
      const serviceCards = services.map(service => {
        const status = subscriptionStatuses.find(s => 
          s.service && s.service._id.toString() === service._id.toString()
        );
        
        return {
          ...service.toObject(),
          status: status ? status.currentStatus : 'Unknown',
          nextRenewalDate: status ? status.nextRenewalDate : null,
          daysUntilRenewal: status ? status.daysUntilRenewal : null,
          lastPaymentDate: status && status.lastPayment ? status.lastPayment.paymentDate : null
        };
      });

      res.render('dashboard/admin/manage-subscriptions', {
        admin: req.user,
        services: serviceCards,
        paymentHistory,
        summary: {
          totalServices,
          activeServices,
          expiringServices,
          expiredServices,
          totalSpend: totalSpend.length > 0 ? totalSpend[0].total : 0,
          nextRenewal: nextRenewal,
          daysUntilRenewal
        },
        exchangeRate: EXCHANGE_RATE
      });

    } catch (err) {
      console.error("Error loading subscriptions:", err);
      res.status(500).send("Server error loading subscriptions");
    }
  }
);

// ============================================
// POST: Record New Payment
// ============================================
router.post(
  '/admin/record-payment',
  ensureAdmin("manage_subscriptions"), // Adjust permission as needed
  async (req, res) => {
    try {
      const {
        serviceId,
        transactionReference,
        paymentDate,
        amount,
        currency,
        notes
      } = req.body;

      // Validation
      if (!serviceId || !transactionReference || !paymentDate || !amount || !currency) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields'
        });
      }

      // Check if transaction reference already exists
      const existingPayment = await PaymentHistory.findOne({ transactionReference });
      if (existingPayment) {
        return res.status(400).json({
          success: false,
          message: 'Transaction reference already exists'
        });
      }

      // Fetch service details
      const service = await Service.findById(serviceId);
      if (!service) {
        return res.status(404).json({
          success: false,
          message: 'Service not found'
        });
      }

      // Calculate amount in Naira if payment is in USD
      let amountInNaira = parseFloat(amount);
      if (currency === 'USD') {
        amountInNaira = parseFloat(amount) * EXCHANGE_RATE;
      }

      // Calculate renewal period
      const paymentDateObj = new Date(paymentDate);
      let endDate = new Date(paymentDateObj);
      
      if (service.billingPeriod === 'month') {
        endDate.setMonth(endDate.getMonth() + 12); // For monthly services, record 12 months
      } else {
        endDate.setFullYear(endDate.getFullYear() + 1);
      }

      // Create payment record
      const payment = new PaymentHistory({
        service: serviceId,
        serviceName: service.name,
        amount: parseFloat(amount),
        currency,
        amountInNaira,
        exchangeRate: currency === 'USD' ? EXCHANGE_RATE : 1,
        transactionReference,
        paymentDate: paymentDateObj,
        status: 'Paid',
        provider: service.provider,
        renewalPeriod: {
          startDate: paymentDateObj,
          endDate: endDate
        },
        notes: notes || '',
        recordedBy: req.user._id
      });

      await payment.save();

      // Update or create subscription status
      let subscriptionStatus = await SubscriptionStatus.findOne({ service: serviceId });
      
      if (!subscriptionStatus) {
        subscriptionStatus = new SubscriptionStatus({
          service: serviceId,
          currentPeriodStart: paymentDateObj,
          currentPeriodEnd: endDate,
          nextRenewalDate: endDate,
          lastPayment: payment._id,
          totalPayments: 1,
          totalAmountPaid: amountInNaira
        });
      } else {
        subscriptionStatus.currentPeriodStart = paymentDateObj;
        subscriptionStatus.currentPeriodEnd = endDate;
        subscriptionStatus.nextRenewalDate = endDate;
        subscriptionStatus.lastPayment = payment._id;
        subscriptionStatus.totalPayments += 1;
        subscriptionStatus.totalAmountPaid += amountInNaira;
        subscriptionStatus.currentStatus = 'Active';
        subscriptionStatus.reminderSent = false;
      }

      await subscriptionStatus.save();

      // Fetch the saved payment with populated fields for response
      const savedPayment = await PaymentHistory.findById(payment._id)
        .populate('service')
        .populate('recordedBy', 'firstName lastName email');

      res.json({
        success: true,
        message: 'Payment recorded successfully',
        payment: savedPayment
      });

    } catch (err) {
      console.error("Error recording payment:", err);
      res.status(500).json({
        success: false,
        message: 'Server error recording payment',
        error: err.message
      });
    }
  }
);

// ============================================
// GET: Single Payment Details
// ============================================
router.get(
  '/payment/:id',
  ensureAdmin("view_subscriptions"),
  async (req, res) => {
    try {
      const payment = await PaymentHistory.findById(req.params.id)
        .populate('service')
        .populate('recordedBy', 'firstName lastName email');

      if (!payment) {
        return res.status(404).json({
          success: false,
          message: 'Payment not found'
        });
      }

      res.json({
        success: true,
        payment
      });

    } catch (err) {
      console.error("Error fetching payment:", err);
      res.status(500).json({
        success: false,
        message: 'Server error fetching payment'
      });
    }
  }
);

// ============================================
// GET: Payment History (with filters)
// ============================================
router.get(
  '/payment-history',
  ensureAdmin("view_subscriptions"),
  async (req, res) => {
    try {
      const { serviceKey, status, startDate, endDate, limit = 50 } = req.query;
      
      let query = {};
      
      // Filter by service
      if (serviceKey && serviceKey !== 'all') {
        const service = await Service.findOne({ serviceKey });
        if (service) {
          query.service = service._id;
        }
      }
      
      // Filter by status
      if (status && status !== 'all') {
        query.status = status;
      }
      
      // Filter by date range
      if (startDate || endDate) {
        query.paymentDate = {};
        if (startDate) query.paymentDate.$gte = new Date(startDate);
        if (endDate) query.paymentDate.$lte = new Date(endDate);
      }

      const payments = await PaymentHistory.find(query)
        .populate('service')
        .populate('recordedBy', 'firstName lastName email')
        .sort({ paymentDate: -1 })
        .limit(parseInt(limit));

      res.json({
        success: true,
        payments
      });

    } catch (err) {
      console.error("Error fetching payment history:", err);
      res.status(500).json({
        success: false,
        message: 'Server error fetching payment history'
      });
    }
  }
);

// ============================================
// GET: Service Details with History
// ============================================
router.get(
  '/service/:serviceKey',
  ensureAdmin("view_subscriptions"),
  async (req, res) => {
    try {
      const service = await Service.findOne({ serviceKey: req.params.serviceKey });
      
      if (!service) {
        return res.status(404).json({
          success: false,
          message: 'Service not found'
        });
      }

      const status = await SubscriptionStatus.findOne({ service: service._id })
        .populate('lastPayment');

      const payments = await PaymentHistory.find({ service: service._id })
        .sort({ paymentDate: -1 })
        .limit(10);

      res.json({
        success: true,
        service,
        status,
        payments
      });

    } catch (err) {
      console.error("Error fetching service details:", err);
      res.status(500).json({
        success: false,
        message: 'Server error fetching service details'
      });
    }
  }
);






/* ============================================================
   HELPER: Group permissions by category
============================================================ */
function groupPermissions(permissions) {
  const categoryMap = {
    member_management: {
      label: "Member Management",
      icon: "fas fa-users",
      keys: ["view_members", "create_members", "edit_members", "delete_members", "approve_members"],
    },
    financial_operations: {
      label: "Financial Operations",
      icon: "fas fa-wallet",
      keys: ["view_transactions", "process_deposits", "approve_withdrawals", "manage_roi", "view_financial_reports"],
    },
    loan_management: {
      label: "Loan Management",
      icon: "fas fa-hand-holding-usd",
      keys: ["view_loans", "approve_loans", "edit_loans", "manage_loan_settings", "process_loan_payments"],
    },
    reports_analytics: {
      label: "Reports & Analytics",
      icon: "fas fa-chart-bar",
      keys: ["view_reports", "generate_reports", "view_analytics", "export_data"],
    },
    system_settings: {
      label: "System Settings",
      icon: "fas fa-cog",
      keys: ["manage_settings", "view_audit_logs", "manage_membership_types"],
    },
    role_management: {
      label: "Role & Permission Management",
      icon: "fas fa-user-shield",
      keys: ["manage_roles", "assign_roles", "promote_to_admin"],
    },
    subscription_management: {
      label: "Subscription Management",
      icon: "fas fa-credit-card",
      keys: ["view_subscriptions", "manage_subscriptions"],
    },
  };

  const grouped = [];
  const categorized = new Set();

  for (const [, cat] of Object.entries(categoryMap)) {
    const perms = permissions.filter((p) => cat.keys.includes(p.name));
    if (perms.length) {
      grouped.push({ label: cat.label, icon: cat.icon, permissions: perms });
      perms.forEach((p) => categorized.add(p.name));
    }
  }

  const others = permissions.filter((p) => !categorized.has(p.name));
  if (others.length) {
    grouped.push({ label: "Other Permissions", icon: "fas fa-key", permissions: others });
  }

  return grouped;
}

/* ============================================================
   GET /admin/manage-roles
============================================================ */
router.get("/manage-roles", ensureAdmin("manage_roles"), async (req, res) => {
  try {
    const [roles, permissions, assignedUsers, allUsers] = await Promise.all([
      Role.find()
        .populate("permissions", "name description")
        .populate("createdBy", "firstName lastName email")
        .sort({ isSystemRole: -1, createdAt: 1 }),

      Permission.find().sort({ name: 1 }),

      // Users who have a role assigned — uses 'role' field from User schema
      User.find({ role: { $exists: true, $ne: null } })
        .populate({ path: "role", select: "name description" })
        .select("firstName lastName email role status updatedAt")
        .sort({ firstName: 1 }),

      // All users for the assign dropdown
      User.find({})
        .select("firstName lastName email status")
        .sort({ firstName: 1 })
        .limit(200),
    ]);

    const stats = {
      totalRoles: roles.length,
      totalPermissions: permissions.length,
      activeRoles: roles.filter((r) => r.isActive).length,
      assignedUsers: assignedUsers.length,
    };

    res.render("dashboard/admin/manage-roles", {
      admin: req.user,
      roles,
      permissions,
      groupedPermissions: groupPermissions(permissions),
      assignedUsers,
      allUsers,
      stats,
    });
  } catch (err) {
    console.error("Error loading manage-roles:", err);
    res.status(500).send("Server error loading roles management");
  }
});

/* ============================================================
   POST /admin/manage-roles/create
============================================================ */
router.post("/admin/manage-roles/create", ensureAdmin("manage_roles"), async (req, res) => {
  try {
    const { name, description, permissions } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Role name is required" });
    }

    const existing = await Role.findOne({ name: name.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ success: false, message: `Role "${name}" already exists` });
    }

    const permIds = Array.isArray(permissions) ? permissions : permissions ? [permissions] : [];
    const validPerms = await Permission.find({ _id: { $in: permIds } }).select("_id");

    const role = await Role.create({
      name: name.toLowerCase().trim(),
      description: description?.trim() || "",
      permissions: validPerms.map((p) => p._id),
      isSystemRole: false,
      isActive: true,
      createdBy: req.user._id,
    });

    await role.populate("permissions", "name description");

    return res.status(201).json({
      success: true,
      message: `Role "${role.name}" created with ${role.permissions.length} permission(s)`,
      role,
    });
  } catch (err) {
    console.error("Error creating role:", err);
    return res.status(500).json({ success: false, message: "Server error creating role" });
  }
});

/* ============================================================
   GET /admin/manage-roles/:roleId  — details + assigned users
============================================================ */
router.get("/admin/manage-roles/:roleId", ensureAdmin("manage_roles"), async (req, res) => {
  try {
    const { roleId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(roleId)) {
      return res.status(400).json({ success: false, message: "Invalid role ID" });
    }

    const [role, assignedUsers] = await Promise.all([
      Role.findById(roleId)
        .populate("permissions", "name description isSystemPermission")
        .populate("createdBy", "firstName lastName email"),

      // 'role' field per User schema
      User.find({ role: roleId })
        .select("firstName lastName email status createdAt"),
    ]);

    if (!role) {
      return res.status(404).json({ success: false, message: "Role not found" });
    }

    return res.json({ success: true, role, assignedUsers });
  } catch (err) {
    console.error("Error fetching role:", err);
    return res.status(500).json({ success: false, message: "Server error fetching role details" });
  }
});

/* ============================================================
   PUT /admin/manage-roles/:roleId  — update role
============================================================ */
router.put("/admin/manage-roles/:roleId", ensureAdmin("manage_roles"), async (req, res) => {
  try {
    const { roleId } = req.params;
    const { name, description, permissions, isActive } = req.body;

    if (!mongoose.Types.ObjectId.isValid(roleId)) {
      return res.status(400).json({ success: false, message: "Invalid role ID" });
    }

    const role = await Role.findById(roleId);
    if (!role) return res.status(404).json({ success: false, message: "Role not found" });

    if (name && name.toLowerCase().trim() !== role.name && !role.isSystemRole) {
      const duplicate = await Role.findOne({ name: name.toLowerCase().trim(), _id: { $ne: roleId } });
      if (duplicate) {
        return res.status(409).json({ success: false, message: `Role "${name}" already exists` });
      }
      role.name = name.toLowerCase().trim();
    }

    if (description !== undefined) role.description = description.trim();

    if (permissions !== undefined) {
      const permIds = Array.isArray(permissions) ? permissions : permissions ? [permissions] : [];
      const valid = await Permission.find({ _id: { $in: permIds } }).select("_id");
      role.permissions = valid.map((p) => p._id);
    }

    if (isActive !== undefined && !role.isSystemRole) {
      role.isActive = isActive === true || isActive === "true";
    }

    await role.save();
    await role.populate("permissions", "name description");

    return res.json({ success: true, message: `Role "${role.name}" updated successfully`, role });
  } catch (err) {
    console.error("Error updating role:", err);
    return res.status(500).json({ success: false, message: err.message || "Server error updating role" });
  }
});

/* ============================================================
   DELETE /admin/manage-roles/:roleId  — delete role
============================================================ */
router.delete("/admin/manage-roles/:roleId", ensureAdmin("manage_roles"), async (req, res) => {
  try {
    const { roleId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(roleId)) {
      return res.status(400).json({ success: false, message: "Invalid role ID" });
    }

    const role = await Role.findById(roleId);
    if (!role) return res.status(404).json({ success: false, message: "Role not found" });
    if (role.isSystemRole) {
      return res.status(403).json({ success: false, message: "System roles cannot be deleted" });
    }

    // Unset role from all assigned users
    await User.updateMany({ role: roleId }, { $unset: { role: "" } });
    await role.deleteOne();

    return res.json({ success: true, message: `Role "${role.name}" deleted successfully` });
  } catch (err) {
    console.error("Error deleting role:", err);
    return res.status(500).json({ success: false, message: err.message || "Server error deleting role" });
  }
});

/* ============================================================
   POST /admin/manage-roles/assign-user  — assign role to user
============================================================ */
router.post("/admin/manage-roles/assign-user", async (req, res) => {
  try {
    console.log("🔥 ASSIGN ROLE ROUTE HIT");
    console.log("➡️ Request Body:", req.body);

    const { userId, roleId } = req.body;

    console.log("➡️ userId:", userId);
    console.log("➡️ roleId:", roleId);

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(roleId)) {
      console.log("❌ Invalid ObjectId");
      return res.status(400).json({
        success: false,
        message: "Invalid user or role ID"
      });
    }

    const [user, role] = await Promise.all([
      User.findById(userId).select("firstName lastName email role"),
      Role.findById(roleId).select("name isActive"),
    ]);

    console.log("➡️ Found User:", user);
    console.log("➡️ Found Role:", role);

    if (!user) {
      console.log("❌ User not found");
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (!role) {
      console.log("❌ Role not found");
      return res.status(404).json({ success: false, message: "Role not found" });
    }

    if (!role.isActive) {
      console.log("❌ Role inactive");
      return res.status(400).json({
        success: false,
        message: "Cannot assign an inactive role"
      });
    }

    console.log("➡️ Current User Role:", user.role);

    user.role = role._id;

    console.log("➡️ New Role To Save:", role._id);

    await user.save();

    console.log("✅ User saved successfully");

    return res.json({
      success: true,
      message: `Role "${role.name}" assigned to ${user.firstName} ${user.lastName}`,
      user: {
        _id: user._id,
        name: `${user.firstName} ${user.lastName}`,
        email: user.email,
        role: { _id: role._id, name: role.name },
      },
    });

  } catch (err) {
    console.error("💥 Error assigning role:", err);
    return res.status(500).json({
      success: false,
      message: "Server error assigning role"
    });
  }
});


/* ============================================================
   DELETE /admin/manage-roles/remove-user/:userId
============================================================ */
router.delete(
  "/admin/manage-roles/remove-user/:userId",
  async (req, res) => {
    try {
      const { userId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid user ID"
        });
      }

      const user = await User.findById(userId).populate("role");

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      // 🚨 Prevent removing superadmin role
      if (user.role && user.role.name === "superadmin") {
        return res.status(403).json({
          success: false,
          message: "Superadmin role cannot be removed"
        });
      }

      // ✅ Find system member role
      const memberRole = await Role.findOne({
        name: "member",
        isSystemRole: true,
        isActive: true
      });

      if (!memberRole) {
        return res.status(500).json({
          success: false,
          message: "Default member role not found. Contact system administrator."
        });
      }

      const userName = `${user.firstName} ${user.lastName}`;

      // 🔁 Reassign to member role
      user.role = memberRole._id;
      await user.save();

      return res.json({
        success: true,
        message: `${userName} has been reassigned to Member role`
      });

    } catch (err) {
      console.error("Error removing role:", err);
      return res.status(500).json({
        success: false,
        message: "Server error removing role"
      });
    }
  }
);

/* ============================================================
   POST /admin/manage-roles/:roleId/add-permission
============================================================ */
router.post("/manage-roles/:roleId/add-permission", ensureAdmin("manage_roles"), async (req, res) => {
  try {
    const { roleId } = req.params;
    const { permissionId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(roleId) || !mongoose.Types.ObjectId.isValid(permissionId)) {
      return res.status(400).json({ success: false, message: "Invalid IDs" });
    }

    const [role, permission] = await Promise.all([
      Role.findById(roleId),
      Permission.findById(permissionId),
    ]);

    if (!role) return res.status(404).json({ success: false, message: "Role not found" });
    if (!permission) return res.status(404).json({ success: false, message: "Permission not found" });

    if (!role.permissions.some((p) => p.toString() === permissionId)) {
      role.permissions.push(permissionId);
      await role.save();
    }

    return res.json({
      success: true,
      message: `Permission "${permission.name}" added to "${role.name}"`,
      permissionCount: role.permissions.length,
    });
  } catch (err) {
    console.error("Error adding permission:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ============================================================
   DELETE /admin/manage-roles/:roleId/remove-permission/:permissionId
============================================================ */
router.delete(
  "/manage-roles/:roleId/remove-permission/:permissionId",
  ensureAdmin("manage_roles"),
  async (req, res) => {
    try {
      const { roleId, permissionId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(roleId) || !mongoose.Types.ObjectId.isValid(permissionId)) {
        return res.status(400).json({ success: false, message: "Invalid IDs" });
      }

      const role = await Role.findById(roleId);
      if (!role) return res.status(404).json({ success: false, message: "Role not found" });

      role.permissions = role.permissions.filter((p) => p.toString() !== permissionId);
      await role.save();

      return res.json({
        success: true,
        message: "Permission removed",
        permissionCount: role.permissions.length,
      });
    } catch (err) {
      console.error("Error removing permission:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }
);












// ─── Build Mongoose query from filter params ─────────────────────────────────
function buildQuery({ type, direction, from, to }) {
  const q = {};
  if (type)      q.type      = type;
  if (direction) q.direction = direction;
  if (from || to) {
    q.createdAt = {};
    if (from) q.createdAt.$gte = new Date(from);
    if (to)   q.createdAt.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
  }
  return q;
}

// ─── Sum amounts for a match ─────────────────────────────────────────────────
async function aggSum(matchObj) {
  const r = await CompanyLedger.aggregate([
    { $match: matchObj },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return r[0]?.total || 0;
}

const populateOpts = [
  { path: "relatedUser", select: "firstName lastName membershipID" },
  { path: "recordedBy",  select: "firstName lastName fullName" },
];

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/finance
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/admin/finance",
  ensureAdmin("view_finance"),
  async (req, res) => {
    try {
      const perPage     = 20;
      const currentPage = Math.max(1, parseInt(req.query.page) || 1);

      const filterType      = req.query.type      || "";
      const filterDirection = req.query.direction || "";
      const filterFrom      = req.query.from      || "";
      const filterTo        = req.query.to        || "";

      // Full active query (type + direction + date)
      const activeQuery = buildQuery(req.query);

      // ── All-time balance for header pill ──
      const [allIn, allOut] = await Promise.all([
        aggSum({ direction: "in" }),
        aggSum({ direction: "out" }),
      ]);
      const companyBalance = allIn - allOut;

      // ── Period stats: ONLY date (and type) filter, NOT direction filter
      //    so we always know both in and out for the period
      const periodBase = buildQuery({ type: filterType, from: filterFrom, to: filterTo });
      const [periodIn, periodOut] = await Promise.all([
        aggSum({ ...periodBase, direction: "in"  }),
        aggSum({ ...periodBase, direction: "out" }),
      ]);
      const periodNet = periodIn - periodOut;

      // ── Opening balance: all entries BEFORE filterFrom ──
      let openingBalance = 0;
      if (filterFrom) {
        const d = new Date(filterFrom);
        const [obIn, obOut] = await Promise.all([
          aggSum({ direction: "in",  createdAt: { $lt: d } }),
          aggSum({ direction: "out", createdAt: { $lt: d } }),
        ]);
        openingBalance = obIn - obOut;
      }
      const closingBalance = openingBalance + periodIn - periodOut;

      // ── Paginated entries ──
      const [entries, totalEntries] = await Promise.all([
        CompanyLedger.find(activeQuery)
          .sort({ createdAt: 1 })
          .skip((currentPage - 1) * perPage)
          .limit(perPage)
          .populate(populateOpts),
        CompanyLedger.countDocuments(activeQuery),
      ]);
      const totalPages = Math.ceil(totalEntries / perPage) || 1;

      // ── Running balance per row ──
      let runningBalance = openingBalance;
      if (currentPage > 1) {
        const prev = await CompanyLedger.find(activeQuery)
          .sort({ createdAt: 1 })
          .limit((currentPage - 1) * perPage)
          .select("amount direction");
        for (const e of prev)
          runningBalance += e.direction === "in" ? e.amount : -e.amount;
      }

      const entriesWithBalance = entries.map((entry) => {
        const obj = entry.toObject();
        runningBalance += entry.direction === "in" ? entry.amount : -entry.amount;
        obj.runningBalance = runningBalance;
        return obj;
      });

      res.render("dashboard/admin/finance", {
        admin: req.user,
        entries: entriesWithBalance,
        totalEntries,
        totalPages,
        currentPage,
        perPage,
        filterType,
        filterDirection,
        filterFrom,
        filterTo,
        companyBalance,
        periodIn,
        periodOut,
        periodNet,
        openingBalance,
        closingBalance,
      });
    } catch (err) {
      console.error("Error loading finance page:", err);
      res.status(500).send("Server error");
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/finance/credit
// ─────────────────────────────────────────────────────────────────────────────
const CREDIT_TYPES = ["manual_credit", "external_income", "registration_fee", "penalty_income", "rollover_income"];

router.post("/admin/finance/credit", ensureAdmin("manage_finance"), async (req, res) => {
  try {
    const { type, amount, description } = req.body;
    if (!type || !amount || !description)
      return res.status(400).json({ status: false, message: "All fields are required." });
    if (!CREDIT_TYPES.includes(type))
      return res.status(400).json({ status: false, message: "Invalid credit type." });
    const n = parseFloat(amount);
    if (isNaN(n) || n <= 0)
      return res.status(400).json({ status: false, message: "Amount must be a positive number." });

    await CompanyLedger.create({
      type, amount: n, direction: "in",
      description: description.trim(),
      recordedBy: req.user._id,
      meta: { addedManually: true, adminName: req.user.fullName || `${req.user.firstName} ${req.user.lastName}` },
    });
    return res.json({ status: true, message: `₦${n.toLocaleString()} credited successfully.` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/finance/debit
// ─────────────────────────────────────────────────────────────────────────────
const DEBIT_TYPES = ["manual_debit", "withdrawal"];

router.post("/admin/finance/debit", ensureAdmin("manage_finance"), async (req, res) => {
  try {
    const { type, amount, description } = req.body;
    if (!type || !amount || !description)
      return res.status(400).json({ status: false, message: "All fields are required." });
    if (!DEBIT_TYPES.includes(type))
      return res.status(400).json({ status: false, message: "Invalid debit type." });
    const n = parseFloat(amount);
    if (isNaN(n) || n <= 0)
      return res.status(400).json({ status: false, message: "Amount must be a positive number." });

    const [aIn, aOut] = await Promise.all([aggSum({ direction: "in" }), aggSum({ direction: "out" })]);
    const balance = aIn - aOut;
    if (n > balance)
      return res.status(400).json({ status: false, message: `Insufficient balance. Current: ₦${balance.toLocaleString()}.` });

    await CompanyLedger.create({
      type, amount: n, direction: "out",
      description: description.trim(),
      recordedBy: req.user._id,
      meta: { debitedManually: true, adminName: req.user.fullName || `${req.user.firstName} ${req.user.lastName}` },
    });
    return res.json({ status: true, message: `₦${n.toLocaleString()} debited successfully.` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/finance/export/csv
// ─────────────────────────────────────────────────────────────────────────────
router.get("/admin/finance/export/csv", ensureAdmin("view_finance"), async (req, res) => {
  try {
    const activeQuery = buildQuery(req.query);
    const filterFrom  = req.query.from || "";
    let running = 0;
    if (filterFrom) {
      const d = new Date(filterFrom);
      const [oIn, oOut] = await Promise.all([
        aggSum({ direction: "in", createdAt: { $lt: d } }),
        aggSum({ direction: "out", createdAt: { $lt: d } }),
      ]);
      running = oIn - oOut;
    }

    const entries = await CompanyLedger.find(activeQuery).sort({ createdAt: 1 }).populate(populateOpts);

    const rows = [
      ["Date", "Type", "Direction", "Amount", "Balance After", "Member", "Membership ID", "Description", "Recorded By"],
      ...entries.map((e) => {
        running += e.direction === "in" ? e.amount : -e.amount;
        const rec = e.recordedBy
          ? (e.recordedBy.fullName || `${e.recordedBy.firstName || ""} ${e.recordedBy.lastName || ""}`.trim())
          : "System";
        return [
          `"${new Date(e.createdAt).toLocaleString("en-NG")}"`,
          e.type.replace(/_/g, " "),
          e.direction,
          e.amount,
          running,
          e.relatedUser ? `${e.relatedUser.firstName} ${e.relatedUser.lastName}` : "",
          e.relatedUser?.membershipID || "",
          `"${(e.description || "").replace(/"/g, '""')}"`,
          rec,
        ];
      }),
    ];

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="ledger-${Date.now()}.csv"`);
    return res.send(rows.map((r) => r.join(",")).join("\n"));
  } catch (err) {
    console.error(err);
    return res.status(500).send("Error generating CSV");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/finance/export/pdf  — renders a print-ready HTML page
// ─────────────────────────────────────────────────────────────────────────────
router.get("/admin/finance/export/pdf", ensureAdmin("view_finance"), async (req, res) => {
  try {
    const filterFrom  = req.query.from || "";
    const filterTo    = req.query.to   || "";
    const filterType  = req.query.type || "";
    const filterDirection = req.query.direction || "";

    const activeQuery = buildQuery(req.query);

    let openingBalance = 0;
    if (filterFrom) {
      const d = new Date(filterFrom);
      const [oIn, oOut] = await Promise.all([
        aggSum({ direction: "in",  createdAt: { $lt: d } }),
        aggSum({ direction: "out", createdAt: { $lt: d } }),
      ]);
      openingBalance = oIn - oOut;
    }

    const periodBase = buildQuery({ type: filterType, from: filterFrom, to: filterTo });
    const [periodIn, periodOut] = await Promise.all([
      aggSum({ ...periodBase, direction: "in" }),
      aggSum({ ...periodBase, direction: "out" }),
    ]);
    const closingBalance = openingBalance + periodIn - periodOut;

    const entries = await CompanyLedger.find(activeQuery).sort({ createdAt: 1 }).populate(populateOpts);

    let running = openingBalance;
    const entriesWithBalance = entries.map((e) => {
      running += e.direction === "in" ? e.amount : -e.amount;
      return { ...e.toObject(), runningBalance: running };
    });

    res.render("dashboard/admin/finance-pdf", {
      layout: false,
      entries: entriesWithBalance,
      filterFrom, filterTo, filterType, filterDirection,
      periodIn, periodOut,
      periodNet: periodIn - periodOut,
      openingBalance, closingBalance,
      generatedAt: new Date().toLocaleString("en-NG"),
      adminName: req.user.fullName || `${req.user.firstName} ${req.user.lastName}`,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).send("Error generating PDF export");
  }
});








































// ── Helpers ──────────────────────────────────────────────────────────────────

function buildOpQuery({ type, direction, from, to } = {}) {
  const q = {};
  if (type)      q.type      = type;
  if (direction) q.direction = direction;
  if (from || to) {
    q.createdAt = {};
    if (from) q.createdAt.$gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      q.createdAt.$lte = end;
    }
  }
  return q;
}

async function opAggSum(query) {
  const result = await OperatingLedger.aggregate([
    { $match: query },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return result[0]?.total || 0;
}

const opPopulateOpts = [
  { path: "relatedUser", select: "firstName lastName membershipID" },
  { path: "relatedLoan", select: "_id" },
  { path: "recordedBy",  select: "firstName lastName fullName" },
];

// ── GET /admin/operating-earnings ────────────────────────────────────────────

router.get(
  "/admin/operating-earnings",
  ensureAdmin("view_finance"),
  async (req, res) => {
    try {
      const perPage     = 20;
      const currentPage = Math.max(1, parseInt(req.query.page) || 1);

      const filterType      = req.query.type      || "";
      const filterDirection = req.query.direction || "";
      const filterFrom      = req.query.from      || "";
      const filterTo        = req.query.to        || "";

      // Full query used for the paginated table (type + direction + date)
      const activeQuery = buildOpQuery({
        type:      filterType,
        direction: filterDirection,
        from:      filterFrom,
        to:        filterTo,
      });

      // ── All-time operating balance (header pill) ──────────────────────────
      const [allIn, allOut] = await Promise.all([
        opAggSum({ direction: "in" }),
        opAggSum({ direction: "out" }),
      ]);
      const operatingBalance = allIn - allOut;

      // ── Period stats: type + date only, NO direction filter ───────────────
      //    So we always get both sides of the ledger for the chosen period
      const periodBase = buildOpQuery({ type: filterType, from: filterFrom, to: filterTo });
      const [periodIn, periodOut] = await Promise.all([
        opAggSum({ ...periodBase, direction: "in"  }),
        opAggSum({ ...periodBase, direction: "out" }),
      ]);
      const periodNet = periodIn - periodOut;

      // ── Opening balance: all entries BEFORE filterFrom ────────────────────
      let openingBalance = 0;
      if (filterFrom) {
        const d = new Date(filterFrom);
        const [obIn, obOut] = await Promise.all([
          opAggSum({ direction: "in",  createdAt: { $lt: d } }),
          opAggSum({ direction: "out", createdAt: { $lt: d } }),
        ]);
        openingBalance = obIn - obOut;
      }
      const closingBalance = openingBalance + periodIn - periodOut;

      // ── Banner / stat card breakdowns ─────────────────────────────────────
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

      const [totalLoanCharges, totalStaffPayments, monthlyCharges] = await Promise.all([
        opAggSum({ type: "operating_charge", direction: "in" }),
        opAggSum({ type: "staff_payment",    direction: "out" }),
        opAggSum({ type: "operating_charge", direction: "in", createdAt: { $gte: monthStart } }),
      ]);

      // ── Current operating charge % from settings ──────────────────────────
      const settings           = await Settings.getSettings();
      const roiOperatingCharge = Number(settings.otherFees?.roiOperatingCharge || 10);

      // ── Paginated entries ─────────────────────────────────────────────────
      const [entries, totalEntries] = await Promise.all([
        OperatingLedger.find(activeQuery)
          .sort({ createdAt: 1 })
          .skip((currentPage - 1) * perPage)
          .limit(perPage)
          .populate(opPopulateOpts),
        OperatingLedger.countDocuments(activeQuery),
      ]);
      const totalPages = Math.ceil(totalEntries / perPage) || 1;

      // ── Running balance per row ───────────────────────────────────────────
      let runningBalance = openingBalance;
      if (currentPage > 1) {
        const prev = await OperatingLedger.find(activeQuery)
          .sort({ createdAt: 1 })
          .limit((currentPage - 1) * perPage)
          .select("amount direction");
        for (const e of prev)
          runningBalance += e.direction === "in" ? e.amount : -e.amount;
      }

      const entriesWithBalance = entries.map((entry) => {
        const obj = entry.toObject();
        runningBalance += entry.direction === "in" ? entry.amount : -entry.amount;
        obj.runningBalance = runningBalance;
        return obj;
      });

      res.render("dashboard/admin/operating-earnings", {
        admin: req.user,
        entries: entriesWithBalance,
        totalEntries,
        totalPages,
        currentPage,
        perPage,
        filterType,
        filterDirection,
        filterFrom,
        filterTo,
        operatingBalance,
        periodIn,
        periodOut,
        periodNet,
        openingBalance,
        closingBalance,
        totalLoanCharges,
        totalStaffPayments,
        monthlyCharges,
        roiOperatingCharge,
      });
    } catch (err) {
      console.error("Error loading operating earnings page:", err);
      res.status(500).send("Server error");
    }
  }
);

module.exports = router;
