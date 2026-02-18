const mongoose = require("mongoose");

const memberTypeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },

  shortCode: {
    type: String,
    required: true,
    trim: true
  },

  interestRate: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
    default: 0
  },

  isDefault: {
    type: Boolean,
    default: false
  },

  // New Financial Settings
  forceWithdrawalPenalty: {
    type: Number,
    min: 0,
    max: 100,
    default: 2,
    description: "Penalty percentage for forced withdrawals"
  },

  loanRolloverRate: {
    type: Number,
    min: 0,
    max: 100,
    default: 0,
    description: "Interest rate charged when rolling over a loan"
  },

  loanPenaltyRate: {
    type: Number,
    min: 0,
    max: 100,
    default: 0,
    description: "Penalty rate for late loan payments"
  },

  loanPenaltyType: {
    type: String,
    enum: ['percentage', 'fixed'],
    default: 'percentage',
    description: "Whether penalty is a percentage or fixed amount"
  },

  gracePeriodDays: {
    type: Number,
    min: 0,
    default: 0,
    description: "Grace period in days before penalties apply"
  },

  maxLoanAmount: {
    type: Number,
    min: 0,
    default: 0,
    description: "Maximum loan amount allowed for this membership type (0 = unlimited)"
  },

  minDepositBeforeLoan: {
    type: Number,
    min: 0,
    default: 0,
    description: "Minimum deposit required before loan eligibility"
  },

  loanToDepositRatio: {
    type: Number,
    min: 0,
    max: 100,
    default: 80,
    description: "Maximum loan as percentage of total deposits"
  },

  allowForcedWithdrawal: {
    type: Boolean,
    default: true,
    description: "Whether forced withdrawals are allowed"
  },

  earlyWithdrawalPeriodMonths: {
    type: Number,
    min: 0,
    default: 6,
    description: "Months before withdrawal is considered early and penalty applies"
  },

  // ROI/Dividend Settings
  roiDistributionFrequency: {
    type: String,
    enum: ['monthly', 'quarterly', 'biannually', 'annually'],
    default: 'monthly',
    description: "How often ROI is distributed"
  },

  minimumBalanceForROI: {
    type: Number,
    min: 0,
    default: 0,
    description: "Minimum balance required to earn ROI"
  }

}, {
  timestamps: true
});

// Pre-save middleware to ensure only one default type
memberTypeSchema.pre('save', async function(next) {
  if (this.isDefault) {
    await this.constructor.updateMany(
      { _id: { $ne: this._id }, isDefault: true },
      { isDefault: false }
    );
  }
  next();
});

module.exports = mongoose.model("MemberType", memberTypeSchema);