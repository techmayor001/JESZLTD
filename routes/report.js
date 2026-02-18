const express = require("express");
const router = express.Router();
const User = require("../models/User");        // adjust path as needed
const Role = require("../models/Role");        // adjust path as needed
const Account = require("../models/Account"); // adjust path as needed
const {
  DepositReport,
  WithdrawalReport,
  LoanReport,
  ExtraCharge,
  AdminActionLog,
  SubscriptionReport,
} = require("../models/ReportSchemas");

// HANDLING APPROVAL OF ACCESS TO ADMIN DASHBOARD - MIDDLEWARE ------------- TECHMAYOR COMPANY LIMITED 
function ensureAdmin(requiredPermission = null) {
  return (req, res, next) => {

    if (!req.isAuthenticated()) {
      return res.redirect(
        `/login?redirect=${encodeURIComponent(req.originalUrl)}`
      );
    }

    if (!req.user.role) {
      return res.status(403).render("auth/forbidden", {
        reason: "norole",
        user: req.user,
      });
    }

    if (!req.user.role.isActive) {
      return res.status(403).render("auth/forbidden", {
        reason: "inactive",
        user: req.user,
      });
    }

    // ❌ Block members completely
    if (req.user.role.name === "member") {
      return res.status(403).render("auth/forbidden", {
        reason: "member",
        user: req.user,
      });
    }

    // ✅ If permission is required, check it
    if (requiredPermission) {
      const hasPermission = req.user.role.permissions.some(
        (perm) => perm.name === requiredPermission
      );

      if (!hasPermission) {
        return res.status(403).render("auth/forbidden", {
          reason: "permission",
          user: req.user,
        });
      }
    }

    return next();
  };
}
// ENDS HERE 
/* ============================================================
   HELPER — build a createdAt date range filter
============================================================ */
function buildDateFilter(from, to, field = "createdAt") {
  const filter = {};
  if (from || to) {
    filter[field] = {};
    if (from) filter[field].$gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      filter[field].$lte = end;
    }
  }
  return filter;
}

/* ============================================================
   HELPER — sum a numeric field across an array
============================================================ */
function sumField(arr, field) {
  return arr.reduce((acc, d) => acc + (Number(d[field]) || 0), 0);
}

/* ============================================================
   HELPER — filter account.monthlyRoiHistory by date range.
   Each sub-doc: { month: "YYYY-MM", roi: Number, createdAt: Date }
============================================================ */
function filterRoiHistory(history = [], dateFrom, dateTo) {
  let entries = [...history];

  if (dateFrom) {
    const from = new Date(dateFrom);
    entries = entries.filter((e) => new Date(e.createdAt) >= from);
  }

  if (dateTo) {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    entries = entries.filter((e) => new Date(e.createdAt) <= end);
  }

  // Newest first
  entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return entries;
}

/* ============================================================
   GET /admin/reports
   Main report page. No data is shown until a membershipID is provided.
============================================================ */
router.get(
  "/admin/reports",
  ensureAdmin("view_reports"),
  async (req, res) => {
    try {
      const {
        membershipID,
        dateFrom,
        dateTo,
        // deposits | withdrawals | loans | roi | extracharges | subscriptions | admin_actions | all
        reportType,
      } = req.query;

      let member     = null;
      let reportData = null;

      if (membershipID && membershipID.trim()) {
        /* ── Find member ─────────────────────────────────────────── */
        member = await User.findOne({
          membershipID: {
            $regex: new RegExp(
              `^${membershipID.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
              "i"
            ),
          },
        })
          .populate({
            path: "account",
            // Populate accountType nested inside account
            populate: {
              path: "accountType",
              model: "MemberType",
              select: "name shortCode interestRate",
            },
          })
          .populate("role", "name description");

        if (member) {
          const dateFilter = buildDateFilter(dateFrom, dateTo);
          const memberId   = member._id;
          const type       = reportType || "all";

          reportData = {};

          /* ── DEPOSITS ─────────────────────────────────────────── */
          if (type === "all" || type === "deposits") {
            const deposits = await DepositReport.find({
              member: memberId,
              ...dateFilter,
            })
              .populate({
                path: "processedBy",
                select: "firstName lastName membershipID",
                populate: { path: "role", select: "name" },
              })
              .sort({ createdAt: -1 });

            reportData.deposits = {
              records:       deposits,
              totalAmount:   sumField(deposits, "amount"),
              totalApproved: sumField(
                deposits.filter((d) => d.status === "approved"), "amount"
              ),
              totalPending:  sumField(
                deposits.filter((d) => d.status === "pending"),  "amount"
              ),
              totalRejected: sumField(
                deposits.filter((d) => d.status === "rejected"), "amount"
              ),
              count: deposits.length,
            };
          }

          /* ── WITHDRAWALS ──────────────────────────────────────── */
          if (type === "all" || type === "withdrawals") {
            const withdrawals = await WithdrawalReport.find({
              member: memberId,
              ...dateFilter,
            })
              .populate({
                path: "approvedBy",
                select: "firstName lastName membershipID",
                populate: { path: "role", select: "name" },
              })
              .sort({ createdAt: -1 });

            reportData.withdrawals = {
              records:        withdrawals,
              totalAmount:    sumField(withdrawals, "amount"),
              totalCompleted: sumField(
                withdrawals.filter((w) => w.status === "completed"), "amount"
              ),
              totalPending:   sumField(
                withdrawals.filter((w) => w.status === "pending"),   "amount"
              ),
              totalFees: sumField(withdrawals, "fee"),
              count:     withdrawals.length,
            };
          }

          /* ── LOANS ── full lifecycle: guarantors + repayments ─── */
          if (type === "all" || type === "loans") {
            const loans = await LoanReport.find({
              member: memberId,
              ...dateFilter,
            })
              .populate({
                path: "guarantors.guarantor",
                select: "firstName lastName membershipID email phone",
              })
              .populate({
                path: "repayments.receivedBy",
                select: "firstName lastName membershipID",
                populate: { path: "role", select: "name" },
              })
              .populate({
                path: "reviewedBy",
                select: "firstName lastName membershipID",
                populate: { path: "role", select: "name" },
              })
              .sort({ createdAt: -1 });

            reportData.loans = {
              records:          loans,
              totalBorrowed:    sumField(loans, "principalAmount"),
              totalRepaid:      sumField(loans, "amountRepaid"),
              totalOutstanding: sumField(loans, "outstandingBalance"),
              totalInterest:    sumField(loans, "interestAmount"),
              activeCount:      loans.filter((l) => l.status === "active").length,
              completedCount:   loans.filter((l) => l.status === "completed").length,
              count:            loans.length,
            };
          }

          /* ── ROI ── pulled from account.monthlyRoiHistory ─────── */
          // No separate ROI collection — everything lives on the Account doc.
          if (type === "all" || type === "roi") {
            const rawHistory   = member.account?.monthlyRoiHistory || [];
            const filtered     = filterRoiHistory(rawHistory, dateFrom, dateTo);
            const totalROI     = sumField(filtered, "roi");

            reportData.roi = {
              records:           filtered,    // [{ month, roi, createdAt }]
              totalROI,
              // Lifetime accumulated ROI (not filtered — it's a running total on Account)
              accumulativeROI:   member.account?.accumulativeROI || 0,
              lastRoiPayout:     member.account?.lastRoiPayout   || null,
              count:             filtered.length,
              totalHistoryCount: rawHistory.length,  // all-time count for context
            };
          }

          /* ── EXTRA CHARGES ────────────────────────────────────── */
          if (type === "all" || type === "extracharges") {
            const charges = await ExtraCharge.find({
              member: memberId,
              ...dateFilter,
            })
              .populate({
                path: "chargedBy",
                select: "firstName lastName membershipID",
                populate: { path: "role", select: "name" },
              })
              .populate({
                path: "approvedBy",
                select: "firstName lastName membershipID",
                populate: { path: "role", select: "name" },
              })
              .populate({
                path: "waivedBy",
                select: "firstName lastName membershipID",
                populate: { path: "role", select: "name" },
              })
              .sort({ createdAt: -1 });

            reportData.extraCharges = {
              records:      charges,
              totalAmount:  sumField(charges, "amount"),
              totalPaid:    sumField(charges.filter((c) => c.status === "paid"),    "amount"),
              totalWaived:  sumField(charges.filter((c) => c.status === "waived"),  "amount"),
              totalPending: sumField(charges.filter((c) => c.status === "pending"), "amount"),
              count:        charges.length,
            };
          }

          /* ── SUBSCRIPTIONS (maintenance fees) ─────────────────── */
          if (type === "all" || type === "subscriptions") {
            const subs = await SubscriptionReport.find({
              member: memberId,
              ...dateFilter,
            })
              .populate({
                path: "processedBy",
                select: "firstName lastName membershipID",
                populate: { path: "role", select: "name" },
              })
              .sort({ createdAt: -1 });

            reportData.subscriptions = {
              records:      subs,
              totalAmount:  sumField(subs, "amount"),
              totalPaid:    sumField(subs.filter((s) => s.status === "paid"),    "amount"),
              totalOverdue: sumField(subs.filter((s) => s.status === "overdue"), "amount"),
              totalWaived:  sumField(subs.filter((s) => s.status === "waived"),  "amount"),
              count:        subs.length,
            };
          }

          /* ── ADMIN ACTIONS — every admin action on this member ── */
          if (type === "all" || type === "admin_actions") {
            const actions = await AdminActionLog.find({
              targetUser: memberId,
              ...dateFilter,
            })
              .populate({
                path: "admin",
                select: "firstName lastName membershipID",
                populate: { path: "role", select: "name" },
              })
              .sort({ createdAt: -1 });

            reportData.adminActions = {
              records: actions,
              count:   actions.length,
            };
          }

          /* ── SUMMARY TOTALS (all-mode only) ───────────────────── */
          if (type === "all") {
            const totalDeposits    = reportData.deposits?.totalApproved     || 0;
            const totalWithdrawals = reportData.withdrawals?.totalCompleted  || 0;
            const totalROI         = reportData.roi?.totalROI               || 0;
            const totalCharges     = reportData.extraCharges?.totalPaid     || 0;
            const totalSubs        = reportData.subscriptions?.totalPaid    || 0;
            const totalLoansOut    = reportData.loans?.totalOutstanding     || 0;

            reportData.summary = {
              totalDeposits,
              totalWithdrawals,
              totalROI,
              totalCharges,
              totalSubscriptions:    totalSubs,
              totalLoansOutstanding: totalLoansOut,
              // Period net cash flow
              netFlow: totalDeposits + totalROI - totalWithdrawals - totalCharges - totalSubs,
              // Live balance from Account document
              currentBalance: member.account?.balance || 0,
            };
          }
        }
      }

      res.render("dashboard/admin/reports", {
        admin:     req.user,
        member,
        reportData,
        query:     req.query,
        pageTitle: "Reports",
      });
    } catch (error) {
      console.error("Error loading reports page:", error);
      res.status(500).send("Internal Server Error");
    }
  }
);

/* ============================================================
   GET /admin/reports/admin-actions
   System-wide audit log (not filtered to a single member).
   Returns JSON — handy for an AJAX data table on a separate page.
============================================================ */
router.get(
  "/admin/reports/admin-actions",
  ensureAdmin("view_reports"),
  async (req, res) => {
    try {
      const {
        dateFrom, dateTo,
        actionType, adminId,
        page  = 1,
        limit = 100,
      } = req.query;

      const filter = { ...buildDateFilter(dateFrom, dateTo) };
      if (actionType) filter.actionType = actionType;
      if (adminId)    filter.admin = adminId;

      const skip  = (Number(page) - 1) * Number(limit);
      const total = await AdminActionLog.countDocuments(filter);

      const actions = await AdminActionLog.find(filter)
        .populate({
          path: "admin",
          select: "firstName lastName membershipID",
          populate: { path: "role", select: "name" },
        })
        .populate("targetUser", "firstName lastName membershipID")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit));

      // Non-member users for filter dropdown
      const memberRole = await Role.findOne({ name: /^member$/i }).select("_id");
      const admins = await User.find({
        role:   { $ne: memberRole?._id },
        status: "active",
      })
        .populate("role", "name")
        .select("firstName lastName membershipID role");

      return res.json({
        actions,
        admins,
        total,
        page:  Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      });
    } catch (err) {
      console.error("Admin actions report error:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

module.exports = router;