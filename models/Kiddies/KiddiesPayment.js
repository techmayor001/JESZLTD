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

    // Who physically made the bank transfer (manual payments only)
    payeeName: {
      type: String,
      trim: true,
      default: null,
    },

    // Distinguishes a registration payment (fee + initial deposit)
    // from a plain top-up deposit
    paymentType: {
      type: String,
      enum: ["registration", "deposit"],
      required: true,
    },

    status: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
    },

    // For Paystack payments: the full Paystack webhook/verify payload.
    // For manual payments: null (payeeName + paymentType carry the context).
    paystackResponse: {
      type: Object,
      default: null,
    },

    verifiedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("KiddiesPayment", kiddiesPaymentSchema);