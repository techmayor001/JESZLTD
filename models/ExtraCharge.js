const mongoose = require("mongoose");

const extraChargeSchema = new mongoose.Schema(
  {
    member: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    chargeType: {
      type: String,
      enum: [
        "registration",
        "loan-penalty",
        "forceful-withdrawal",
        "late-payment",
        "service",
        "other",
      ],
      required: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    relatedLoan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Loan",
      default: null,
    },

    reason: {
      type: String,
    },

    status: {
      type: String,
      enum: [
        "pending",    // charge recorded but not yet collected
        "paid",       // charge collected
        "reversed",   // charge was paid but then reversed (e.g. withdrawal rejected)
      ],
      default: "pending",
    },

    appliedAt: {
      type: Date,
      default: Date.now,
    },

    paidAt: {
      type: Date,
    },

    /* Populated when status is set to "reversed" */
    reversedAt: {
      type: Date,
    },

    reversedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    reversalReason: {
      type: String,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ExtraCharge", extraChargeSchema);