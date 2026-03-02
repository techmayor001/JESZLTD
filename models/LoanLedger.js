const mongoose = require("mongoose");

const loanLedgerSchema = new mongoose.Schema({
  loan: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Loan", 
    required: true 
  },
  member: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
  },
  externalBorrower: {
    borrowerName: String,
    email: String,
    phone: String
  },
  approvedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Admin",
    required: true 
  },
  amount: { 
    type: Number, 
    required: true 
  },
  interestRate: { 
    type: Number, 
    required: true 
  },

  // ── Replaces durationMonths ──────────────────────────
  durationValue: { 
    type: Number, 
    required: true 
  },
  durationUnit: {
    type: String,
    enum: ["minutes", "hours", "days", "weeks", "months"],
    default: "months"
  },
  // Keep for backwards compatibility with old records
  durationMonths: { 
    type: Number
    // removed required: true
  },
  // ─────────────────────────────────────────────────────

  penaltyPercentage: {
    type: Number,
    default: 0
  },
  rolloverPercentage: {
    type: Number,
    default: 0
  },
  disbursementMethod: { 
    type: String, 
    enum: ["bank", "cash", "check"], 
    required: true 
  },
  disbursementDate: { 
    type: Date, 
    required: true 
  },
  dueDate: {
    type: Date
  },
  approvedAt: { 
    type: Date, 
    default: Date.now 
  },
  status: { 
    type: String, 
    enum: ["approved", "paid", "defaulted"], 
    default: "approved" 
  }
});

module.exports = mongoose.model("LoanLedger", loanLedgerSchema);