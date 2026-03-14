const mongoose = require("mongoose");

const companyLedgerSchema = new mongoose.Schema({

  type: {
    type: String,
    enum: [
      "deposit",
      "withdrawal",
      "loan_disbursement",
      "loan_repayment",
      "registration_fee",
      "penalty_income",
      "rollover_income",
      "manual_credit",
      "manual_debit",
      "external_income",
      "overpayment_refund"
    ],
    required: true
  },

  amount: {
    type: Number,
    required: true
  },

  direction: {
    type: String,
    enum: ["in", "out"],
    required: true
  },

  relatedUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },

  relatedLoan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Loan"
  },

  relatedTransaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Transaction"
  },

  description: String,

  recordedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin"
  },

  meta: {
    type: Object
  },

  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }

});

module.exports = mongoose.model("CompanyLedger", companyLedgerSchema);