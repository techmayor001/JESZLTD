const mongoose = require("mongoose");

const accountSchema = mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

  accountType: { type: String, enum: ["CD", "NCD"], required: true },

  balance: { type: Number, default: 0 },

  interestRate: { type: Number, required: true },

  monthlyROI: { type: Number, default: 0 },

  accumulativeROI: { type: Number, default: 0 },

  lastROICalculation: { type: Date, default: Date.now },

  createdAt: { type: Date, default: Date.now },

  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Account", accountSchema);
