const mongoose = require("mongoose");

const kiddiesTransactionSchema = new mongoose.Schema(
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

    type: {
      type: String,
      enum: ["deposit", "interest", "fee", "withdrawal"],
      required: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    balanceAfter: {
      type: Number,
      required: true,
    },

    description: {
      type: String,
      default: "",
    },

    reference: {
      type: String,
    },

    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "completed",
    },

    paymentMethod: {
      type: String,
      enum: ["paystack", "cooperative", "interest", "system"],
      default: "system",
    },

    paystackReference: {
      type: String,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("KiddiesTransaction", kiddiesTransactionSchema);