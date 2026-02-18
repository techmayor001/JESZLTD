const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

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

router.post('/admin/members/approve/:id', ensureAdmin("approve_members"), async (req, res) => {
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
        const membershipID = `${type.shortCode}${String(nextNumber).padStart(4, '0')}`;

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

router.post('/admin/members/delete/:id', ensureAdmin("delete_members"), async (req, res) => {
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

      // ✅ Detect ALL manual payments (deposit + loan)
      const isManual =
        payment.reference.startsWith("COOP-") ||
        payment.reference.startsWith("LOAN-MANUAL-");

      const isPaystack = !isManual;

      // ✅ Correct amount handling
      const amount = isManual
        ? payment.amount
        : payment.amount / 100;

      // ✅ Account balance is always naira
      const balance = payment.user?.account?.balance || 0;

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

        // ✅ Fixed values
        amount,
        balance,

        method: isManual
          ? "Manual Transfer"
          : "Paystack",

        status:
          payment.status === "paid" || payment.status === "success"
            ? "approved"
            : payment.status === "failed"
            ? "rejected"
            : "pending",

        notes: payment.paystackResponse?.message || "Deposit / Loan payment",
      };
    });

    // ❌ Stats unchanged (as requested)
    const totalIncome = payments
      .filter(p => p.status === "paid" || p.status === "success")
      .reduce((sum, p) => sum + p.amount, 0);

    const pendingCount = payments.filter(p => p.status === "pending").length;

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

      const payment = await Payment.findById(id).populate({
        path: "user",
        populate: { path: "account" },
      });

      if (!payment) {
        return res.status(404).json({ message: "Payment not found" });
      }

      // Prevent double approval
      if (payment.status === "success" || payment.status === "paid") {
        return res
          .status(400)
          .json({ message: "Payment already approved" });
      }

      const isLoanPayment = !!payment.loanId;
      const amount = Number(payment.amount);

      // =========================
      // UPDATE PAYMENT RECORD
      // =========================
      payment.status = "success";
      payment.paystackResponse = {
        ...(payment.paystackResponse || {}),
        adminNote: notes || "Approved by admin",
        approvedAt: new Date(),
      };

      // =========================
      // HANDLE LOAN PAYMENT
      // =========================
      if (isLoanPayment) {
        const loan = await Loan.findOne({
          _id: payment.loanId,
          user: payment.user._id,
          status: "approved",
        });

        if (!loan) {
          return res
            .status(404)
            .json({ message: "Loan not found or inactive" });
        }

        // subtract payment
        loan.totalRepay = Math.max(loan.totalRepay - amount, 0);

        await Transaction.create({
          user: payment.user._id,
          type: "loan_payment",
          amount,
          description: `Manual loan repayment approved (${payment.reference})`,
          reference: payment.reference,
          method: "Cooperative",
          status: "successful",
        });

        // loan fully paid
        if (loan.totalRepay === 0) {
          loan.status = "paid";
          await loan.save();

          await Transaction.create({
            user: payment.user._id,
            type: "loan_repayment",
            amount: 0,
            description: "Loan fully settled (manual payment)",
            method: "system",
            status: "successful",
          });

          await Loan.deleteOne({ _id: loan._id });

          console.log(`🎉 Loan cleared for ${payment.user.email}`);
        } else {
          await loan.save();
        }
      }

      // =========================
      // HANDLE NORMAL DEPOSIT
      // =========================
      if (!isLoanPayment && payment.user?.account) {
        const account = payment.user.account;

        // capture balances
        const balanceBefore = account.balance;
        const balanceAfter = balanceBefore + amount;

        // credit account
        account.balance = balanceAfter;
        await account.save();

        // ✅ CREATE DEPOSIT REPORT
        await DepositReport.create({
          member: payment.user._id,
          account: account._id,
          amount,
          type: "bank_transfer",
          reference: payment.reference,
          description: `Manual deposit approved (${payment.reference})`,
          status: "approved",

          balanceBefore,
          balanceAfter,

          processedBy: req.user._id,
          processedByRole: req.user.role?.name || "admin",
          processedAt: new Date(),

          notes: notes || "Approved by admin",
        });

        // update existing transaction
        const transaction = await Transaction.findOne({
          user: payment.user._id,
          reference: payment.reference,
          type: "deposit",
        });

        if (transaction) {
          transaction.status = "successful";
          transaction.method = "Bank Transfer";
          transaction.description =
            transaction.description ||
            `Deposit approved by admin (${payment.reference})`;

          await transaction.save();
        }
      }

      // =========================
      // ADMIN ACTION LOG (AUDIT)
      // =========================
      await AdminActionLog.create({
        admin: req.user._id,
        adminRole: req.user.role?.name || "admin",
        actionType: "deposit_approve",
        targetUser: payment.user._id,
        targetModel: "Payment",
        targetId: payment._id,
        description: `Approved deposit ${payment.reference}`,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        status: "success",
      });

      await payment.save();

      return res.json({
        success: true,
        message: isLoanPayment
          ? "Loan payment approved and applied"
          : "Deposit approved successfully",
        newBalance: payment.user?.account?.balance || 0,
      });
    } catch (error) {
      console.error("Approve payment error:", error);

      res.status(500).json({
        message: "Internal server error",
        error: error.message,
      });
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
router.get("/admin/manage-withdrawals", ensureAdmin("view_withdrawals"), async (req, res) => {
  try {
    // Fetch only withdrawals that are NOT approved
    const withdrawals = await Withdrawal.find({ status: { $ne: "success" } })
      .populate({
        path: "user",
        select: "firstName lastName membershipID email phone account status",
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
        type: withdrawal.type || "normal",
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

    // Stats (optional: you can keep stats for all withdrawals)
    const pendingRequests = withdrawals.filter(
      (w) => w.status === "pending" || w.status === "processing"
    ).length;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const approvedToday = await Withdrawal.countDocuments({
      status: "success",
      createdAt: { $gte: today },
    });

    const rejectedToday = await Withdrawal.countDocuments({
      status: "failed",
      createdAt: { $gte: today },
    });

    const totalAmount = await Withdrawal.aggregate([
      { $match: { status: "success" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    res.render("dashboard/admin/withdrawal", {
      admin: req.user,
      withdrawals: withdrawalData,
      stats: {
        pendingRequests,
        approvedToday,
        rejectedToday,
        totalAmount: totalAmount[0]?.total || 0,
      },
    });
  } catch (error) {
    console.error("Error fetching withdrawals:", error);
    res.status(500).send("Internal Server Error");
  }
});


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




// LOAN MANAGEMENT 
router.get("/admin/manage-loan", ensureAdmin("view_loans"), async (req, res) => {
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

router.get("/admin/external-loans", ensureAdmin("view_external_loans"), async (req, res) => {
  try {
    // Fetch only external loans
    const loans = await Loan.find({ external: { $exists: true } })
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

    // Fetch last 10 payments for these loans
    const payments = await Payment.find({ loan: { $in: loans.map(l => l._id) } })
      .populate("loan") // get the loan document
      .populate("loan.user")
      .populate("loan.external")
      .populate("paidBy") // admin/user who recorded payment
      .sort({ createdAt: -1 })
      .limit(10);

    // Render template and pass payments
    res.render("dashboard/admin/external-loans", {
      admin: req.user,
      loans,
      users,
      payments // <-- pass payments here
    });

  } catch (error) {
    console.error("Error fetching external loans:", error);
    res.status(500).send("Internal Server Error");
  }
});

router.post("/api/loans/approve", ensureAdmin("approve_loans"), async (req, res) => {
  try {
    const { loanId, disbursementMethod, disbursementDate } = req.body;
    if (!loanId || !disbursementMethod || !disbursementDate)
      return res.status(400).json({ message: "Missing required fields." });

    const approvedBy = req.user?._id;
    if (!approvedBy) return res.status(401).json({ message: "Unauthorized." });

    const loan = await Loan.findById(loanId)
      .populate("duration")
      .populate("user")
      .populate("guarantors.guarantor");

    if (!loan) return res.status(404).json({ message: "Loan not found." });

    if (!loan.guarantors.every(g => g.status === "accepted")) {
      return res.status(400).json({ message: "All guarantors must accept." });
    }

    const durationMonths = loan.user ? loan.duration?.duration : loan.externalDuration;
    if (!durationMonths) return res.status(400).json({ message: "Loan duration missing." });

    // Remove previous pending loan
    if (loan.user) {
      const existingLoan = await Loan.findOne({
        user: loan.user._id,
        _id: { $ne: loan._id },
        status: { $in: ["pending", "approved"] }
      });
      if (existingLoan) await Loan.deleteOne({ _id: existingLoan._id });
    }

    // Approve loan
    const disburseDate = new Date(disbursementDate);
    const dueDate = new Date(disburseDate);
    dueDate.setMonth(dueDate.getMonth() + durationMonths);

    loan.status = "approved";
    loan.disbursementMethod = disbursementMethod;
    loan.disbursementDate = disburseDate;
    loan.dueDate = dueDate;
    loan.approvedAt = new Date();
    await loan.save();

    // Ledger
    const ledgerEntry = await LoanLedger.create({
      loan: loan._id,
      approvedBy,
      amount: loan.amount,
      interestRate: loan.interestRate,
      durationMonths,
      disbursementMethod,
      disbursementDate: disburseDate,
      dueDate,
      approvedAt: new Date(),
      status: "approved",
      member: loan.user?._id,
      externalBorrower: loan.user ? undefined : loan.external
    });

    // Borrower transaction
    if (loan.user) {
      await Transaction.create({
        user: loan.user._id,
        type: "loan_payment",
        amount: loan.amount,
        status: "successful",
        method: disbursementMethod,
        description: "Loan approved and disbursed"
      });
    }

    // Settings
    const settings = await Settings.getSettings();
    const roiOperatingCharge = Number(settings.otherFees?.roiOperatingCharge || 10);

    // Month key
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // Interest calculations (per loan)
    const interestForLoan =
      loan.amount * (loan.interestRate / 100) * durationMonths;

    const companyChargeForThisLoan =
      interestForLoan * (roiOperatingCharge / 100);

    const netInterestForThisLoan =
      interestForLoan - companyChargeForThisLoan;

    // Company ROI aggregation
    let companyRoi = await CompanyROI.findOne({ month: currentMonth });

    if (!companyRoi) {
      companyRoi = await CompanyROI.create({
        month: currentMonth,
        totalInterestCollected: interestForLoan,
        companyCharge: companyChargeForThisLoan,
        netInterestForRoi: netInterestForThisLoan,
        totalRoiDistributed: 0,
        status: "open",
        loanRoiHistory: [{
          loan: loan._id,
          interestForLoan,
          companyChargeForLoan: companyChargeForThisLoan,
          netInterestForLoan: netInterestForThisLoan
        }]
      });
    } else {
      companyRoi.totalInterestCollected += interestForLoan;
      companyRoi.companyCharge += companyChargeForThisLoan;
      companyRoi.netInterestForRoi += netInterestForThisLoan;

      companyRoi.loanRoiHistory.push({
        loan: loan._id,
        interestForLoan,
        companyChargeForLoan: companyChargeForThisLoan,
        netInterestForLoan: netInterestForThisLoan
      });
    }

    // ROI Distribution (NEW FORMULA)
    const allAccounts = await Account.find({}).populate("user");

    const totalCumulativeSavings = allAccounts.reduce(
      (sum, acc) => sum + Number(acc.balance || 0),
      0
    );

    const safeMoney = n => Math.round(n * 100) / 100;

    let totalDistributed = 0;

    for (const acc of allAccounts) {
      const userSavings = Number(acc.balance || 0);
      if (userSavings <= 0 || totalCumulativeSavings <= 0) continue;

      const userROI =
        (userSavings / totalCumulativeSavings) * netInterestForThisLoan;

      const roundedROI = safeMoney(userROI);

      // Monthly history (per loan)
      acc.monthlyRoiHistory.push({
        month: currentMonth,
        roi: roundedROI
      });

      // Accumulative ROI
      acc.accumulativeROI = safeMoney(
        acc.accumulativeROI + roundedROI
      );

      acc.lastRoiPayout = new Date();
      await acc.save();

      totalDistributed += roundedROI;

      // ROI transaction
      await Transaction.create({
        user: acc.user._id,
        type: "roi",
        amount: roundedROI,
        status: "successful",
        method: "System Distribution",
        description: `ROI from loan ${loan._id} (${currentMonth})`
      });
    }

    companyRoi.totalRoiDistributed += safeMoney(totalDistributed);
    await companyRoi.save();

    const borrowerName = loan.user
      ? `${loan.user.firstName} ${loan.user.lastName}`
      : loan.external?.borrowerName || "Company";

    return res.status(200).json({
      message: `Loan for ${borrowerName} approved successfully.`,
      roiDistributed: totalDistributed,
      loan,
      ledger: ledgerEntry,
      companyRoi
    });

  } catch (error) {
    console.error("Error approving loan:", error);
    return res.status(500).json({ message: "Server error while approving loan." });
  }
});


router.post("/api/loans/reject", ensureAdmin("reject_loans"), async (req, res) => {
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


router.post("/admin/external-loans", ensureAdmin("issue_external_loans"), async (req, res) => {
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


router.get("/admin/loan/settings", ensureAdmin("manage_loan_settings"), async (req, res) => {
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

router.post("/api/loan/settings/add", ensureAdmin("create_loan_settings"), async (req, res) => {
  try {
    const {
      id, 
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

router.post("/api/loan/settings/toggle", ensureAdmin("manage_loan_settings"), async (req, res) => {
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

router.post("/api/loan/settings/delete", ensureAdmin("delete_loan_settings"), async (req, res) => {
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


// Update ONLY interest rates
router.post("/admin/settings/interest-rates", ensureAdmin("manage_settings"), async (req, res) => {
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

// Update Kiddies Account Settings
router.post("/admin/settings/kiddies-settings", ensureAdmin("manage_settings"), async (req, res) => {
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
router.post("/admin/settings/other-fees", ensureAdmin("manage_settings"), async (req, res) => {
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






module.exports = router;
