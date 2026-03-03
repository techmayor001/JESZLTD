const mongoose = require("mongoose");
const { Schema } = mongoose;

const operatingLedgerSchema = new Schema({

  type: {
    type: String,
    enum: [
      // ── Income ──────────────────────────
      "operating_charge",  // auto-recorded on loan approval
      "interest_income",
      "external_income",
      "manual_credit",
      "other_income",

      // ── Expenses ────────────────────────
      "staff_payment",     // meta: { staffName, staffRole, paymentPeriod }
      "expense",
      "manual_debit",
      "other_expense"
    ],
    required: true,
    index: true
  },

  direction: {
    type: String,
    enum: ["in", "out"],
    required: true,
    index: true
  },

  amount: {
    type: Number,
    required: true,
    min: 0
  },

  /**
   * Running balance snapshot computed and stored at write time.
   * Avoids expensive re-aggregation on every page load.
   */
  runningBalance: {
    type: Number,
    default: 0
  },

  description: {
    type: String,
    trim: true
  },

  // ── Relations ────────────────────────────────────────────────────────────

  /** Loan that triggered this entry (operating_charge entries) */
  relatedLoan: {
    type: Schema.Types.ObjectId,
    ref: "Loan",
    default: null
  },

  /** Member whose action generated this entry */
  relatedUser: {
    type: Schema.Types.ObjectId,
    ref: "User",
    default: null
  },

  /** Admin who manually created this entry. null = system-generated */
  recordedBy: {
    type: Schema.Types.ObjectId,
    ref: "Admin",
    default: null
  },

  // ── Flexible metadata bucket ─────────────────────────────────────────────
  /**
   * operating_charge:
   *   {
   *     loanAmount:     Number,
   *     interestRate:   Number,
   *     durationValue:  Number,
   *     chargePercent:  Number,   // roiOperatingCharge at time of approval
   *     totalInterest:  Number,
   *     chargeAmount:   Number
   *   }
   *
   * staff_payment:
   *   {
   *     staffName:      String,
   *     staffRole:      String,
   *     paymentPeriod:  String    // e.g. "March 2025"
   *   }
   */
  meta: {
    type: Schema.Types.Mixed,
    default: {}
  },

  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }

});

// ── Compound indexes for common query patterns ────────────────────────────────
operatingLedgerSchema.index({ type: 1,      createdAt: -1 });
operatingLedgerSchema.index({ direction: 1, createdAt: -1 });
operatingLedgerSchema.index({ relatedLoan:  1 });
operatingLedgerSchema.index({ relatedUser:  1 });
operatingLedgerSchema.index({ recordedBy:   1 });

module.exports = mongoose.model("OperatingLedger", operatingLedgerSchema);