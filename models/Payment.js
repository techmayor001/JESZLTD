const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  email: {
    type: String,
    required: true
  },

  loanId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Loan"
  },

  amount: {
    type: Number,
    required: true
  },

  reference: {
    type: String,
    required: true,
    unique: true
  },

  payeeName: {
    type: String,
    trim: true,
    default: null
  },

  // ── Unified type field (replaces paymentType) ──────────────────────────────
  type: {
    type: String,
    enum: [
      "registration_fee",
      "loan_repayment",
      "deposit",
      "penalty_payment",
      "extra_charge",
      "external_payment",
      "rollover_request",
      "interest",
      "loan_payment"
    ],
    default: null
  },

  // ── Kept for backwards compatibility with existing documents ───────────────
  paymentType: {
    type: String,
    enum: [
      "registration_fee",
      "loan_repayment",
      "deposit",
      "penalty_payment",
      "extra_charge",
      "external_payment",
      "rollover_request",
      "interest",
      "loan_payment"
    ],
    default: null
  },

  status: {
    type: String,
    enum: ["pending", "paid", "failed", "success"],
    default: "pending",
  },

  paystackResponse: {
    type: Object
  },

  // ── Stores rollover calculation details, used by admin approval route ──────
  meta: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  createdAt: {
    type: Date,
    default: Date.now
  },
});

module.exports = mongoose.model("Payment", paymentSchema);