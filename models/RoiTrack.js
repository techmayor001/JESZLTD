const mongoose = require("mongoose");

const roiSchema = new mongoose.Schema({
  account: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Account",
    required: true
  },

  companyRoi: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "CompanyROI",
    required: true
  },

  month: {
    type: String,
    required: true
  },

  roiAmount: {
    type: Number,
    required: true,
    default: 0
  },

  creditedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model("ROI", roiSchema);
