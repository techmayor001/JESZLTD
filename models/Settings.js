const mongoose = require("mongoose");

const SettingsSchema = new mongoose.Schema(
  {
    // ============================
    // INTEREST RATE CONFIGURATION
    // ============================
    interestRates: {
      clubMemberRate: {
        type: Number,
        default: 5.0,
      },
      nonClubMemberRate: {
        type: Number,
        default: 10.0,
      },
    },

    // ============================
    // MEMBERSHIP REGISTRATION FEES
    // ============================
    registrationFees: {
      adultRegistrationFee: {
        type: Number,
        default: 5000,
      },
      kiddiesRegistrationFee: {
        type: Number,
        default: 5000,
      },
    },

    // ============================
    // KIDDIES ACCOUNT CONFIGURATION
    // ============================
    kiddiesSettings: {
      minAge: {
        type: Number,
        default: 0,
        min: 0,
        max: 17,
      },
      maxAge: {
        type: Number,
        default: 17,
        min: 1,
        max: 18,
      },
      upgradeAge: {
        type: Number,
        default: 18,
        min: 16,
      },

      // Fees
      monthlyMaintenanceFee: {
        type: Number,
        default: 100,
        min: 0,
      },
      upgradeProcessingFee: {
        type: Number,
        default: 1000,
        min: 0,
      },

      // Kiddies interest rate
      kiddiesInterestRate: {
        type: Number,
        default: 7.5,
        min: 0,
        max: 100,
      },

      // Notification (days before upgrade)
      autoUpgradeNotificationDays: {
        type: Number,
        default: 60,
        enum: [30, 60, 90], // match UI options
      },
    },

    // ============================
    // OTHER FEES & CHARGES
    // ============================
    otherFees: {
      forceWithdrawalCharge: {
        type: Number,
        default: 2.5, // %
        min: 0,
        max: 100,
      },
      
      roiOperatingCharge: {
        type: Number,
        default: 10,
        min: 0,
        max: 50,
      },
    },
  },
  {
    timestamps: true,
  }
);

// Ensures only ONE settings document exists
SettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) settings = await this.create({});
  return settings;
};

module.exports = mongoose.model("Settings", SettingsSchema);
