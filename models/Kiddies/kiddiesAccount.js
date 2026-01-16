const mongoose = require("mongoose");

const kiddiesAccountSchema = new mongoose.Schema({
  parent: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User",
    required: true 
  },

  // Child Details
  childFirstName: { type: String, required: true },
  childLastName: { type: String, required: true },
  childDOB: { type: Date, required: true },
  childGender: { type: String, enum: ["Male", "Female"], required: true },

  account: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "Account" 
   },

  // Minimum 5 years locking period
  lockPeriodYears: { type: Number, default: 5 },
  unlockDate: { type: Date },

  // Next of Kin Information
  beneficiaryType: { type: String, enum: ["lawyer", "family"], required: true },

  nextOfKin: {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true },
    relationship: { type: String, required: true },
    address: { type: String, required: true },

    barNumber: { type: String }, // for lawyers
    lawFirm: { type: String }
  },

  // Kiddies account transactions
  transactions: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "KiddiesTransaction"
    }
  ],

  status: {
    type: String,
    enum: ["active", "locked", "closed"],
    default: "active"
  },

  registrationStatus: {
    type: String,
    enum: ["pending", "paid", "failed"],
    default: "pending"
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Auto-set unlock date
kiddiesAccountSchema.pre("save", function (next) {
  if (!this.unlockDate) {
    const unlock = new Date(this.createdAt);
    unlock.setFullYear(unlock.getFullYear() + this.lockPeriodYears);
    this.unlockDate = unlock;
  }
  next();
});

module.exports = mongoose.model("KiddiesAccount", kiddiesAccountSchema);
