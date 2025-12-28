const mongoose = require("mongoose");

const memberTypeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },

  shortCode: {
    type: String,
    required: true,
    trim: true
  },

  interestRate: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
    default: 0
  },

  isDefault: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});
module.exports = mongoose.model("MemberType", memberTypeSchema);