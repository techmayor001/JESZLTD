const mongoose = require("mongoose");
const crypto = require("crypto");

const loanInviteSchema = new mongoose.Schema({
  // The admin who generated this link
  generatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin",
    required: true
  },

  // Unique secure token (used in the URL)
  token: {
    type: String,
    unique: true,
    default: () => crypto.randomBytes(32).toString("hex")
  },

  // Optional: pre-fill some loan parameters set by admin
  // Applicant cannot override these if set
  presetAmount: {
    type: Number,
    default: null
  },
  presetInterestRate: {
    type: Number,
    default: null
  },
  presetDuration: {
    type: Number, // months
    default: null
  },

  // ── Penalty & Rollover settings ─────────────────────────────────────────
  // These are copied onto the Loan document when the application is submitted
  penaltyPercentage: {
    type: Number,
    default: null   // null = use system default from LoanSettings
  },

  rolloverPercentage: {
    type: Number,
    default: null   // null = use system default from LoanSettings
  },

  // Optional: label/note for admin's own reference
  label: {
    type: String,
    trim: true
  },

  // Status of the invite
  status: {
    type: String,
    enum: ["active", "used", "expired", "revoked"],
    default: "active"
  },

  // The loan that was created from this invite (set after applicant submits)
  loan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Loan",
    default: null
  },

  // Expiry — default 7 days from creation
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Virtual: is this invite still usable?
loanInviteSchema.virtual("isValid").get(function () {
  return this.status === "active" && new Date() < this.expiresAt;
});

module.exports = mongoose.model("LoanInvite", loanInviteSchema);