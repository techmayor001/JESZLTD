const mongoose = require("mongoose");

const kiddiesPaymentSchema = new mongoose.Schema(
  {
    kiddiesAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "KiddiesAccount",
      required: true,
    },

    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    email: {
      type: String,
      required: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    reference: {
      type: String,
      required: true,
      unique: true,
    },

    status: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
    },

    paystackResponse: {
      type: mongoose.Schema.Types.Mixed,
    },

    verifiedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("KiddiesPayment", kiddiesPaymentSchema);