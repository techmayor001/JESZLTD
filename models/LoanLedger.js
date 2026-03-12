const mongoose = require("mongoose");

const loanLedgerSchema = new mongoose.Schema({
  loan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Loan",
    required: true
  },

  member: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },

  externalBorrower: {
    borrowerName: String,
    email: String,
    phone: String
  },

  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin",
    required: true
  },

  transactionType: {
    type: String,
    enum: [
      "disbursement",
      "repayment",
      "penalty",
      "rollover",
      "adjustment"
    ],
    required: true
  },

  amount: {
    type: Number,
    required: true
  },

  principalPaid: {
    type: Number,
    default: 0
  },

  interestPaid: {
    type: Number,
    default: 0
  },

  penaltyPaid: {
    type: Number,
    default: 0
  },

  balanceBefore: {
    type: Number
  },

  balanceAfter: {
    type: Number
  },

  paymentMethod: {
    type: String,
    enum: ["bank", "cash", "wallet", "transfer", "paystack"]
  },

  reference: {
    type: String
  },

  notes: {
    type: String
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("LoanLedger", loanLedgerSchema);