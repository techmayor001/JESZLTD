const mongoose = require("mongoose");

const adminPaymentSchema = new mongoose.Schema(
  {
    // Admin who processed the payment
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",   // admins are Users in this system
      required: true,
    },

    // Regular member affected — null for kiddies transactions
    member: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // Kiddies account affected — null for regular member transactions
    kiddiesMember: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "KiddiesAccount",
      default: null,
    },

    // Discriminator — tells the UI and reports which ref is populated
    memberType: {
      type: String,
      enum: ["member", "kiddies"],
      default: "member",
    },

    // Payment type from UI
    paymentType: {
      type: String,
      enum: [
        "deposit",
        "withdrawal",
        "loan-repayment",
        "direct-debit",
      ],
      required: true,
    },

    // Amount entered by admin
    amount: {
      type: Number,
      required: true,
    },

    // Extra charge (used mainly for direct debit)
    chargeAmount: {
      type: Number,
      default: 0,
    },

    // Total debited/credited
    totalAmount: {
      type: Number,
      required: true,
    },

    // Loan reference (ONLY for loan repayment)
    loan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Loan",
      default: null,
    },

    // Charge type (ONLY for direct debit)
    chargeType: {
      type: String,
      enum: ["admin-fee", "penalty", "service", "other"],
      default: null,
    },

    // Payment method
    paymentMethod: {
      type: String,
      enum: ["cash", "bank-transfer", "pos", "online", "cheque"],
      required: true,
    },

    // Optional transaction reference
    reference: {
      type: String,
      default: null,
    },

    // Admin notes
    notes: {
      type: String,
      default: null,
    },

    // Status
    status: {
      type: String,
      enum: ["successful", "pending", "failed"],
      default: "successful",
    },

    // Snapshot balances (VERY IMPORTANT for audits)
    balanceBefore: {
      type: Number,
      required: true,
    },

    balanceAfter: {
      type: Number,
      required: true,
    },
  },
  { timestamps: true }
);

// Indexes for common query patterns
adminPaymentSchema.index({ member: 1, createdAt: -1 });
adminPaymentSchema.index({ kiddiesMember: 1, createdAt: -1 });
adminPaymentSchema.index({ memberType: 1 });
adminPaymentSchema.index({ paymentType: 1 });
adminPaymentSchema.index({ status: 1 });
adminPaymentSchema.index({ admin: 1 });

module.exports = mongoose.model("AdminPayment", adminPaymentSchema);