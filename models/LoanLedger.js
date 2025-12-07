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
    required: true 
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
  durationMonths: { 
    type: Number, 
    required: true 
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
