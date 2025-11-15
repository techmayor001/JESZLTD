const mongoose = require("mongoose");

const loanSchema = mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  amount: { type: Number, required: true },
  interestRate: { type: Number, required: true },
  duration:{type: Number},
  status: { type: String, enum: ["pending", "approved", "rejected", "paid"], default: "pending" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Loan", loanSchema);
