const mongoose = require("mongoose");

const withdrawalSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  /* ── Gross amount the member requested — full amount leaves the account immediately ── */
  amount: {
    type: Number,
    required: true,
  },

  reference: {
    type: String,
    required: true,
    unique: true,
  },

  bankName: {
    type: String,
    required: true,
    trim: true,
  },

  accountName: {
    type: String,
    required: true,
    trim: true,
  },

  accountNumber: {
    type: String,
    required: true,
    trim: true,
  },

  /*
   * "regular"  — regular withdrawal (Dec 1–10 window, no fee)
   * "ondemand" — on-demand withdrawal (anytime, max 2/year, fee applies, max 50% of balance)
   */
  type: {
    type: String,
    enum: ["regular", "ondemand", "child-withdrawal"],
    default: "regular",
  },

  /* ══════════════════════════════════════════════════════════════════════════
     ON-DEMAND FEE FIELDS
     Admin visibility:
       amount        — gross requested (full balance debited)
       penaltyRate   — % from MemberType.forceWithdrawalPenalty
       penaltyAmount — ₦ fee charged (gross × penaltyRate / 100)
       netAmount     — ₦ actually disbursed to member (gross − fee)
  ══════════════════════════════════════════════════════════════════════════ */

  /** Penalty % rate (from MemberType). 0 for normal withdrawals. */
  penaltyRate: {
    type: Number,
    default: 0,
  },

  /** ₦ fee charged. 0 for normal withdrawals. */
  penaltyAmount: {
    type: Number,
    default: 0,
  },

  /** ₦ disbursed to the member (gross − fee). Equals gross for normal withdrawals. */
  netAmount: {
    type: Number,
    default: 0,
  },

  /**
   * "immediate" — single payout, credited immediately (always the case for on-demand
   *               since amount is capped at 50% of balance).
   * "split"     — retained for legacy/edge-case records only.
   */
  payoutType: {
    type: String,
    enum: ["immediate", "split"],
    default: "immediate",
  },

  /** Phase 1 net amount disbursed (= netAmount for immediate; first tranche for split). */
  phase1Amount: {
    type: Number,
    default: 0,
  },

  /** Phase 2 net amount disbursed within 30 days. Always 0 for on-demand (50% cap). */
  phase2Amount: {
    type: Number,
    default: 0,
  },

  /** true when this withdrawal triggered account deactivation (balance dropped below ₦10,000) */
  triggeredDeactivation: {
    type: Boolean,
    default: false,
  },

  status: {
    type: String,
    enum: ["pending", "processing", "success", "failed"],
    default: "pending",
  },

  processedAt: {
    type: Date,
    default: null,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Withdrawal", withdrawalSchema);