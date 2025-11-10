const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  email: { type: String, required: true },
  amount: { type: Number, required: true },
  reference: { type: String, required: true, unique: true },
  status: {
    type: String,
    enum: ["pending", "paid", "failed", "success"],
    default: "pending",
  },

  paystackResponse: { type: Object }, // store Paystack transaction data
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Payment", paymentSchema);
