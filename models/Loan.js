const mongoose = require("mongoose");

const loanSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },

  // External borrower
  external: {
    borrowerType: {
      type: String,
      enum: ["company", "individual"]
    },
    borrowerName: {
      type: String,
      trim: true
    },
    email: {
      type: String,
      lowercase: true,
      trim: true
    },
    phone: {
      type: String,
      trim: true
    },
    address: {
      type: String,
      trim: true
    }
  },

  initiatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },

  amount: {
    type: Number,
    required: true
  },

  interestAmount: {
    type: Number,
  },

  // What the borrower currently owes (grows with each penalty applied)
  outstandingBalance: {
    type: Number,
    default: 0
  },

  totalRepay: {
    type: Number,
    required: true
  },

  // Running total of how much has been repaid (for reporting / progress bar)
  paidAmount: {
    type: Number,
    default: 0
  },

  interestRate: {
    type: Number,
    required: true
  },

  duration: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "LoanSettings",
  },

  externalDuration: {
    type: Number
  },

  dueDate: {
    type: Date
  },

  // ─── Penalty Tracking ────────────────────────────────────────────────────
  penaltyPercentage: {
    type: Number,
    default: 0
  },

  totalPenalty: {
    type: Number,
    default: 0
  },

  lastPenaltyAppliedAt: {
    type: Date,
    default: null
  },

  penaltyHistory: [
    {
      appliedAt:     { type: Date, default: Date.now },
      periodLabel:   { type: String },
      penaltyRate:   { type: Number },
      penaltyAmount: { type: Number },
      balanceBefore: { type: Number },
      balanceAfter:  { type: Number }
    }
  ],

  // ─── Penalty Waiver Tracking ─────────────────────────────────────────────
  penaltyWaived: {
    type: Boolean,
    default: false
  },

  penaltyWaivedAmount: {
    type: Number,
    default: 0
  },

  penaltyWaivedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },

  penaltyWaivedByName: {
    type: String,
    default: null
  },

  penaltyWaivedAt: {
    type: Date,
    default: null
  },

  penaltyWaiverHistory: [
    {
      waivedAt:      { type: Date, default: Date.now },
      waivedAmount:  { type: Number },
      waivedBy:      { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      waivedByName:  { type: String },
      balanceBefore: { type: Number },
      balanceAfter:  { type: Number },
      reason:        { type: String }
    }
  ],
  
  // ─── Rollover Tracking ───────────────────────────────────────────────────
  rolloverPercentage: {
    type: Number,
    default: 0
  },

  rolloverCount: {
    type: Number,
    default: 0
  },

  rolloverHistory: [
    {
      rolledOverAt:  { type: Date, default: Date.now },
      rolloverFee:   { type: Number },
      balanceBefore: { type: Number },
      balanceAfter:  { type: Number },
      newDueDate:    { type: Date },
      processedBy:   { type: mongoose.Schema.Types.ObjectId, ref: "User" }
    }
  ],

  // When this loan is closed by a rollover, stores the ID of the replacement loan
  rolledIntoLoan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Loan",
    default: null
  },

  // ─── Guarantors ──────────────────────────────────────────────────────────
  guarantors: [
    {
      guarantor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
      },
      status: {
        type: String,
        enum: ["pending", "accepted", "declined"],
        default: "pending"
      },
      respondedAt: {
        type: Date
      }
    }
  ],

  // ─── Status ──────────────────────────────────────────────────────────────
  status: {
    type: String,
    enum: [
      "pending",      // awaiting guarantor acceptance + admin approval
      "approved",     // active loan being repaid
      "overdue",      // past due date — set by cron
      "rejected",     // declined by admin
      "paid",         // fully settled by repayment
      "rolled_over"   // closed by a rollover — replaced by a new loan
    ],
    default: "pending"
  },

  overdueAt: {
    type: Date,
    default: null
  },

  paidAt: {
    type: Date,
    default: null
  },

  disbursementMethod: {
    type: String
  },

  disbursementDate: {
    type: Date
  },

  approvedAt: {
    type: Date
  },

  rejectedAt: {
    type: Date
  },

  rejectionReason: {
    type: String
  },

  rejectionDetails: {
    type: String
  },

  createdAt: {
    type: Date,
    default: Date.now
  },

  updatedAt: {
    type: Date,
    default: Date.now
  },
});

module.exports = mongoose.model("Loan", loanSchema);