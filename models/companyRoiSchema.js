const mongoose = require("mongoose");

const companyRoiSchema = new mongoose.Schema({
  month: {
    type: String,
    required: true,
    unique: true
  },

  totalSavings: {
    type: Number
  },

  totalInterestCollected: {
    type: Number,
    required: true
  },

  companyCharge: {
    type: Number,
    required: true
  },

  netInterestForRoi: {
    type: Number,
    required: true
  },

  totalRoiDistributed: {
    type: Number,
    default: 0
  },
  status: { type: String, enum: ["open", "closed"], default: "open" },

  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model("CompanyROI", companyRoiSchema);
