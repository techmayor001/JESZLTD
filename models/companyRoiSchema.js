const mongoose = require("mongoose");

const companyRoiSchema = new mongoose.Schema({
  month: { type: String, required: true, unique: true },

  totalSavings: { type: Number, default: 0 },

  loanRoiHistory: [
    {
      loan: { type: mongoose.Schema.Types.ObjectId, ref: "Loan" },
      interestForLoan: { type: Number, required: true },
      companyChargeForLoan: { type: Number, required: true },
      netInterestForLoan: { type: Number, required: true },
      createdAt: { type: Date, default: Date.now }
    }
  ],

  totalInterestCollected: { type: Number, default: 0 },
  companyCharge: { type: Number, default: 0 },
  netInterestForRoi: { type: Number, default: 0 },
  totalRoiDistributed: { type: Number, default: 0 },

  status: { type: String, enum: ["open", "closed"], default: "open" }
}, { timestamps: true });

module.exports = mongoose.model("CompanyROI", companyRoiSchema);
