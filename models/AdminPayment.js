const mongoose = require("mongoose");

const adminPaymentSchema = new mongoose.Schema(
  {
    // Admin who processed the payment
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },

    // Member affected
    member: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
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
      enum: ["admin", "penalty", "service", "other"],
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
    },

    // Admin notes
    notes: {
      type: String,
    },

    // Status (future-proofing)
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

module.exports = mongoose.model("AdminPayment", adminPaymentSchema);
