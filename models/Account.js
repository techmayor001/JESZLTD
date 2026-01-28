const mongoose = require("mongoose");

const monthlyRoiSchema = new mongoose.Schema({
  month: { type: String, required: true },
  roi: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const accountSchema = mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

  accountType: { type: mongoose.Schema.Types.ObjectId, ref: "MemberType" },

  balance: { type: Number, default: 0 },

  monthlyRoiHistory: [monthlyRoiSchema],

  accumulativeROI: { type: Number, default: 0 },

  lastRoiPayout: { type: Date, default: null },

  createdAt: { type: Date, default: Date.now },

  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Account", accountSchema);
