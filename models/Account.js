const mongoose = require("mongoose");

const accountSchema = mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

  accountType: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "MemberType", 
    required: true 
  },

  balance: { type: Number, default: 0 },

  monthlyROI: { type: Number, default: 0 },

  accumulativeROI: { type: Number, default: 0 },

  createdAt: { type: Date, default: Date.now },

  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Account", accountSchema);
