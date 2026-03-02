const mongoose = require("mongoose");

const kiddiesAccountSchema = new mongoose.Schema({
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  accountID: {
    type: String,
    unique: true,
    sparse: true, // allow null during creation before ID is set
  },

  // Child Details
  childFirstName: { type: String, required: true },
  childLastName: { type: String, required: true },
  childDOB: { type: Date, required: true },
  childGender: { type: String, enum: ["Male", "Female"], required: true },

  account: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Account",
  },

  // Initial deposit amount (recorded for reference)
  initialDeposit: {
    type: Number,
    default: 0,
  },

  // Minimum 5 years locking period
  lockPeriodYears: { type: Number, default: 5 },
  unlockDate: { type: Date },

  // Next of Kin Information
  beneficiaryType: { type: String, enum: ["lawyer", "family"], required: true },

  nextOfKin: {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true },
    relationship: { type: String, required: true },
    address: { type: String, required: true },
    barNumber: { type: String },
    lawFirm: { type: String },
  },

  // Reason logged when next of kin is updated
  beneficiaryUpdateReason: { type: String },

  // Kiddies account transactions
  transactions: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "KiddiesTransaction",
    },
  ],

  status: {
    type: String,
    enum: ["active", "locked", "closed"],
    default: "locked", // locked until admin approves
  },

  registrationStatus: {
    type: String,
    enum: ["pending", "paid", "failed"],
    default: "pending",
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Auto-set unlock date based on lockPeriodYears
kiddiesAccountSchema.pre("save", function (next) {
  if (!this.unlockDate) {
    const unlock = new Date(this.createdAt || Date.now());
    unlock.setFullYear(unlock.getFullYear() + (this.lockPeriodYears || 5));
    this.unlockDate = unlock;
  }
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("KiddiesAccount", kiddiesAccountSchema);