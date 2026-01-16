const mongoose = require("mongoose");

const loanSettingsSchema = new mongoose.Schema({
  loanName: {
    type: String,
    required: true,
    trim: true
  },

  duration: {
    type: Number,
    required: true
  },

  // Penalty for late repayment
  penaltyPercentage: {
    type: Number,
    default: 0
  },

  // Amount added when user rolls over a loan
  rolloverPercentage: {
    type: Number,
    default: 0
  },

  // Loan eligibility requirement
  eligibilityUnit: {
    type: String,
    enum: ["daily", "days", "weeks", "months"],
    required: true
  },

  eligibilityValue: {
    type: Number,
    required: true
  },

  status: {
    type: String,
    enum: ["active", "inactive"],
    default: "active"
  },

  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("LoanSettings", loanSettingsSchema);
