const mongoose = require("mongoose");

const transactionSchema = mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  type: { type: String, enum: ["deposit", "withdrawal", "loan_payment"], required: true },
  amount: { type: Number, required: true },
  status: {
    type: String,
    enum: ["successful", "failed", "pending"],
    default: "successful"
  },
  description: { type: String },
  reference: { type: String },

  method: { type: String },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Transaction", transactionSchema);
