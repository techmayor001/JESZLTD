const mongoose = require("mongoose");

const kiddiesTransactionSchema = new mongoose.Schema({
  account: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "KiddiesAccount", 
    required: true 
  },

  type: { 
    type: String, 
    enum: ["deposit", "roi", "withdraw"], 
    required: true 
  },

  amount: { type: Number, required: true },

  narration: { type: String },

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("KiddiesTransaction", kiddiesTransactionSchema);
