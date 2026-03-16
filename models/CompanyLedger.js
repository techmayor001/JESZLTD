const mongoose = require("mongoose");

const companyLedgerSchema = new mongoose.Schema({

  type: {
    type: String,
    enum: [
      "deposit",
      "kiddies_deposit_approve",
      "withdrawal",
      "foreced_withdrawal",   // legacy — kept so old records still validate
      "forced_withdrawal",    // correct spelling — used by all new code
      "loan_disbursement",
      "loan_repayment",
      "registration_fee",
      "penalty_income",
      "rollover_income",
      "manual_credit",
      "manual_debit",
      "external_income",
      "overpayment_refund",
    ],
    required: true,
  },

  amount: {
    type: Number,
    required: true,
  },

  direction: {
    type: String,
    enum: ["in", "out"],
    required: true,
  },

  relatedUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },

  relatedLoan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Loan",
  },

  relatedTransaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Transaction",
  },

  description: String,

  recordedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",   // was "Admin" — changed to "User" since admins are Users in this system
  },

  meta: {
    type: Object,
  },

  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },

});

module.exports = mongoose.model("CompanyLedger", companyLedgerSchema);