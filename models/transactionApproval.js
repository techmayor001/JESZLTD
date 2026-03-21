const mongoose = require("mongoose");

/* ============================================================
   TRANSACTION APPROVAL SCHEMA
   - A pending transaction requires 3 non-member user approvals
   - Any user whose role.name !== 'member' can approve/decline
   - Once 3 approvals are reached, the transaction is finalized
   - A single decline immediately rejects the transaction
============================================================ */
const approvalSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    action: {
      type: String,
      enum: ["approved", "declined"],
      required: true,
    },
    comment: {
      type: String,
      trim: true,
    },
    respondedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const transactionApprovalSchema = new mongoose.Schema(
  {
    /* ── Who submitted this transaction request ── */
    initiatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    /* ── The member whose account will be affected ──
       Only one of `member` or `kiddiesMember` will be set,
       depending on `memberType`. Both are optional at the
       schema level so kiddies transactions don't need a User ref
       and regular transactions don't need a KiddiesAccount ref. */
    member: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    /* ── Kiddies account (set when memberType === 'kiddies') ── */
    kiddiesMember: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "KiddiesAccount",
      default: null,
    },

    /* ── Discriminator so routes know which ref to load ── */
    memberType: {
      type: String,
      enum: ["member", "kiddies"],
      default: "member",
    },

    paymentType: {
      type: String,
      enum: ["deposit", "withdrawal", "loan-repayment", "direct-debit"],
      required: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    chargeAmount: {
      type: Number,
      default: 0,
    },

    totalAmount: {
      type: Number,
      required: true,
    },

    paymentMethod: {
      type: String,
      required: true,
    },

    reference: {
      type: String,
      default: null,
    },

    notes: {
      type: String,
      default: null,
    },

    loan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Loan",
      default: null,
    },

    chargeType: {
      type: String,
      default: null,
    },

    /* ── Approval votes recorded ── */
    approvals: [approvalSchema],

    approvalsRequired: {
      type: Number,
      default: 3,
    },

    /* Running count of 'approved' votes for quick queries */
    approvalCount: {
      type: Number,
      default: 0,
    },

    /*
      Users with non-member roles explicitly invited to approve.
      Validated at creation: each user's populated role.name must not be 'member'.
    */
    selectedApprovers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    /* ── Lifecycle ── */
    status: {
      type: String,
      enum: ["pending", "approved", "declined", "processed"],
      default: "pending",
    },

    /* Populated once the transaction is finalized and AdminPayment is created */
    adminPayment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminPayment",
      default: null,
    },

    declinedReason: {
      type: String,
      default: null,
    },

    finalizedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

/* ── Indexes for common query patterns ── */
transactionApprovalSchema.index({ status: 1, createdAt: -1 });
transactionApprovalSchema.index({ initiatedBy: 1 });
transactionApprovalSchema.index({ selectedApprovers: 1 });
transactionApprovalSchema.index({ member: 1 });
transactionApprovalSchema.index({ kiddiesMember: 1 });
transactionApprovalSchema.index({ memberType: 1 });

module.exports = mongoose.model("TransactionApproval", transactionApprovalSchema);