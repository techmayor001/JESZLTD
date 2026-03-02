const mongoose = require("mongoose");

const loanSettingsSchema = new mongoose.Schema({
  loanName: {
    type: String,
    required: true,
    trim: true
  },

  // Duration value (e.g., 5)
  duration: {
    type: Number,
    required: true
  },

  // Duration unit — supports minutes/hours for quick testing
  durationUnit: {
    type: String,
    enum: ["minutes", "hours", "days", "weeks", "months"],
    default: "months"
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
    enum: ["minutes", "hours", "daily", "days", "weeks", "months"],
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