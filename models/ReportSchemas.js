const mongoose = require("mongoose");

/* ============================================================
   DEPOSIT REPORT SCHEMA
   Tracks every deposit transaction with full audit trail
============================================================ */
const depositReportSchema = new mongoose.Schema(
  {
    member: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    type: {
      type: String,
      enum: ["cash", "bank_transfer", "online", "cheque", "direct_debit"],
      default: "bank_transfer",
    },

    reference: {
      type: String,
      unique: true,
      trim: true,
    },

    description: {
      type: String,
      trim: true,
      default: "Deposit",
    },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "reversed"],
      default: "pending",
      index: true,
    },

    balanceBefore: {
      type: Number,
      default: 0,
    },

    balanceAfter: {
      type: Number,
      default: 0,
    },

    // Who approved / rejected this deposit
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    processedAt: {
      type: Date,
    },

    processedByRole: {
      type: String, // snapshot of role name at time of action
    },

    // Optional reversal info
    reversedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    reversedAt: {
      type: Date,
    },

    reversalReason: {
      type: String,
    },

    // Supporting document (proof of payment)
    proofOfPayment: {
      type: String,
    },

    notes: {
      type: String,
    },
  },
  { timestamps: true }
);

depositReportSchema.index({ member: 1, createdAt: -1 });
depositReportSchema.index({ status: 1, createdAt: -1 });

/* ============================================================
   WITHDRAWAL REPORT SCHEMA
   Tracks every withdrawal with approver audit trail
============================================================ */
const withdrawalReportSchema = new mongoose.Schema(
  {
    member: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    fee: {
      type: Number,
      default: 0,
    },

    netAmount: {
      type: Number, // amount - fee
      default: 0,
    },

    type: {
      type: String,
      enum: ["bank_transfer", "cash", "cheque"],
      default: "bank_transfer",
    },

    reference: {
      type: String,
      unique: true,
      trim: true,
    },

    description: {
      type: String,
      default: "Withdrawal",
    },

    bankDetails: {
      bankName: String,
      accountNumber: String,
      accountName: String,
    },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "processing", "completed", "reversed"],
      default: "pending",
      index: true,
    },

    balanceBefore: {
      type: Number,
      default: 0,
    },

    balanceAfter: {
      type: Number,
      default: 0,
    },

    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      // could be member themselves or an admin acting on behalf
    },

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    approvedAt: {
      type: Date,
    },

    approvedByRole: {
      type: String,
    },

    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    rejectedAt: {
      type: Date,
    },

    rejectionReason: {
      type: String,
    },

    notes: {
      type: String,
    },
  },
  { timestamps: true }
);

withdrawalReportSchema.index({ member: 1, createdAt: -1 });
withdrawalReportSchema.index({ status: 1, createdAt: -1 });

/* ============================================================
   LOAN REPORT SCHEMA
   Full lifecycle: application → guarantors → approval → repayments
============================================================ */
const loanRepaymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true },
    principal: { type: Number, default: 0 },
    interest: { type: Number, default: 0 },
    balanceBefore: { type: Number, default: 0 },
    balanceAfter: { type: Number, default: 0 },
    paidAt: { type: Date, default: Date.now },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    receivedByRole: { type: String },
    reference: { type: String },
    status: {
      type: String,
      enum: ["pending", "confirmed", "reversed"],
      default: "confirmed",
    },
  },
  { _id: true }
);

const loanGuarantorSchema = new mongoose.Schema(
  {
    guarantor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined"],
      default: "pending",
    },
    respondedAt: { type: Date },
  },
  { _id: true }
);

const loanReportSchema = new mongoose.Schema(
  {
    member: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
    },

    loanRef: {
      type: String,
      unique: true,
      trim: true,
    },

    principalAmount: {
      type: Number,
      required: true,
    },

    interestRate: {
      type: Number,
      required: true,
      comment: "Annual percentage rate",
    },

    interestAmount: {
      type: Number,
      default: 0,
    },

    totalRepayable: {
      type: Number,
      default: 0,
    },

    amountRepaid: {
      type: Number,
      default: 0,
    },

    outstandingBalance: {
      type: Number,
      default: 0,
    },

    durationMonths: {
      type: Number,
      required: true,
    },

    monthlyInstalment: {
      type: Number,
      default: 0,
    },

    disbursedAt: {
      type: Date,
    },

    dueDate: {
      type: Date,
    },

    status: {
      type: String,
      enum: [
        "pending",
        "under_review",
        "approved",
        "active",
        "completed",
        "defaulted",
        "rejected",
        "cancelled",
      ],
      default: "pending",
      index: true,
    },

    purpose: {
      type: String,
    },

    guarantors: [loanGuarantorSchema],

    repayments: [loanRepaymentSchema],

    // The admin who finally approved/rejected the loan
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    reviewedAt: {
      type: Date,
    },

    reviewedByRole: {
      type: String,
    },

    rejectionReason: {
      type: String,
    },

    notes: {
      type: String,
    },
  },
  { timestamps: true }
);

loanReportSchema.index({ member: 1, createdAt: -1 });
loanReportSchema.index({ status: 1, createdAt: -1 });
loanReportSchema.index({ loanRef: 1 }, { unique: true, sparse: true });

/* ============================================================
   EXTRA CHARGES SCHEMA
   Fines, penalties, admin fees, etc.
============================================================ */
const extraChargeSchema = new mongoose.Schema(
  {
    member: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
    },

    chargeType: {
      type: String,
      enum: [
        "fine",
        "penalty",
        "admin_fee",
        "processing_fee",
        "late_payment",
        "maintenance",
        "other",
      ],
      required: true,
    },

    description: {
      type: String,
      required: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    status: {
      type: String,
      enum: ["pending", "paid", "waived", "reversed"],
      default: "pending",
    },

    balanceBefore: {
      type: Number,
      default: 0,
    },

    balanceAfter: {
      type: Number,
      default: 0,
    },

    chargedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    chargedByRole: {
      type: String,
    },

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    approvedByRole: {
      type: String,
    },

    paidAt: {
      type: Date,
    },

    waivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    waivedAt: {
      type: Date,
    },

    waiverReason: {
      type: String,
    },

    reference: {
      type: String,
    },

    notes: {
      type: String,
    },
  },
  { timestamps: true }
);

extraChargeSchema.index({ member: 1, createdAt: -1 });
extraChargeSchema.index({ chargeType: 1, status: 1 });

/* ============================================================
   ADMIN ACTION LOG SCHEMA
   Complete audit log of all admin actions across the system
============================================================ */
const adminActionLogSchema = new mongoose.Schema(
  {
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    adminRole: {
      type: String,
      required: true,
      comment: "Snapshot of role name at time of action",
    },

    actionType: {
      type: String,
      required: true,
      enum: [
        // Member management
        "member_approve",
        "member_reject",
        "member_delete",
        "member_edit",
        "member_create",
        "member_status_change",
        // Financial
        "deposit_approve",
        "deposit_reject",
        "deposit_reverse",
        "withdrawal_approve",
        "withdrawal_reject",
        "loan_approve",
        "loan_reject",
        "loan_disburse",
        "roi_distribute",
        "extra_charge_add",
        "extra_charge_waive",
        // System
        "role_create",
        "role_edit",
        "role_delete",
        "permission_update",
        "settings_update",
        "subscription_update",
        // Auth
        "admin_login",
        "admin_logout",
        "password_reset",
        "other",
      ],
      index: true,
    },

    targetUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      comment: "The member/user this action was performed on",
    },

    targetModel: {
      type: String,
      comment: "e.g. Loan, Deposit, Withdrawal, User",
    },

    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      comment: "ID of the document that was affected",
    },

    description: {
      type: String,
      required: true,
    },

    changes: {
      type: mongoose.Schema.Types.Mixed,
      comment: "before/after snapshot of changed fields",
    },

    ipAddress: {
      type: String,
    },

    userAgent: {
      type: String,
    },

    status: {
      type: String,
      enum: ["success", "failed", "partial"],
      default: "success",
    },

    errorMessage: {
      type: String,
    },
  },
  { timestamps: true }
);

adminActionLogSchema.index({ admin: 1, createdAt: -1 });
adminActionLogSchema.index({ actionType: 1, createdAt: -1 });
adminActionLogSchema.index({ targetUser: 1, createdAt: -1 });

/* ============================================================
   SUBSCRIPTION REPORT SCHEMA
   Tracks site maintenance / subscription payments
============================================================ */
const subscriptionReportSchema = new mongoose.Schema(
  {
    member: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
    },

    subscriptionPlan: {
      type: String,
      required: true,
      comment: "Plan name e.g. Basic, Premium",
    },

    amount: {
      type: Number,
      required: true,
    },

    period: {
      type: String,
      comment: "e.g. '2024-01' for monthly billing period",
    },

    dueDate: {
      type: Date,
    },

    paidDate: {
      type: Date,
    },

    status: {
      type: String,
      enum: ["pending", "paid", "overdue", "waived", "cancelled"],
      default: "pending",
      index: true,
    },

    isLateFee: {
      type: Boolean,
      default: false,
    },

    lateFeeAmount: {
      type: Number,
      default: 0,
    },

    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    processedByRole: {
      type: String,
    },

    reference: {
      type: String,
    },

    notes: {
      type: String,
    },
  },
  { timestamps: true }
);

subscriptionReportSchema.index({ member: 1, createdAt: -1 });
subscriptionReportSchema.index({ status: 1, dueDate: 1 });

/* ============================================================
   EXPORTS
============================================================ */
module.exports = {
  DepositReport: mongoose.model("DepositReport", depositReportSchema),
  WithdrawalReport: mongoose.model("WithdrawalReport", withdrawalReportSchema),
  LoanReport: mongoose.model("LoanReport", loanReportSchema),
  ExtraCharge: mongoose.model("ExtraChargeReport", extraChargeSchema),
  AdminActionLog: mongoose.model("AdminActionLog", adminActionLogSchema),
  SubscriptionReport: mongoose.model("SubscriptionReport", subscriptionReportSchema),
};