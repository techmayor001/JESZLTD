const mongoose = require("mongoose");

const withdrawalSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
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

  bankName: {
    type: String,
    required: true,
    trim: true,
  },

  accountName: {
    type: String,
    required: true,
    trim: true,
  },

  accountNumber: {
    type: String,
    required: true,
    trim: true,
  },

  type: {
    type: String,
    enum: ["normal", "forceful"],
    default: "normal",
  },

  

  status: {
    type: String,
    enum: ["pending", "processing", "success", "failed"],
    default: "pending",
  },

  processedAt: {
    type: Date,
    default: null,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Withdrawal", withdrawalSchema);
