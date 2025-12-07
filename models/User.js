const mongoose = require("mongoose");

const guarantorRequestSchema = new mongoose.Schema({
  borrower: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true 
  },

  loan: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Loan" 
  },

  amount: { 
    type: Number, 
    required: true 
  },

  status: { 
    type: String, 
    enum: ["pending", "accepted", "declined"], 
    default: "pending" 
  },

  createdAt: { 
    type: Date, 
    default: Date.now 
  },

  respondedAt: { 
    type: Date 
  }
});

const userSchema = new mongoose.Schema({
  firstName: { 
    type: String, 
    required: true 
  },

  lastName: { 
    type: String, 
    required: true 
  },

  email: { 
    type: String, 
    required: true 
  },

  phone: { 
    type: String 
  },

  dob: { 
    type: String 
  },

  state: { 
    type: String, 
    required: true 
  },

  lga: { 
    type: String, 
    required: true 
  },

  address: { 
    type: String, 
    required: true 
  },

  addressProof: { 
    type: String, 
    required: true 
  },

  passportPhoto: { 
    type: String, 
    required: true 
  },

  idType: { 
    type: String, 
    enum: ["nin", "passport", "drivers", "voters"], 
    required: true 
  },

  idNumber: { 
    type: String 
  },

  idFile: { 
    type: String, 
    required: true 
  },

  signature: { 
    type: String, 
    required: true 
  },

  displayPicture: { 
    type: String 
  },

  Payment: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Payment" 
  },

  loans: [
    { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "Loan" 
    }
  ],

  account: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Account" 
  },

  kiddiesAccounts: [
  {
    type: mongoose.Schema.Types.ObjectId,
    ref: "KiddiesAccount"
    }
  ],
  
  registrationStatus: {
    type: String,
    enum: ["pending", "paid", "failed"],
    default: "pending"
  },

  status: { 
    type: String, 
    enum: ["pending", "active", "rejected"], 
    default: "pending" 
  },

  referralCode: { 
    type: String, 
    required: true 
  },

  membershipID: { 
    type: String 
  },

  password: { 
    type: String, 
    required: true 
  },

  referredUsers: [
    { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User" 
    }
  ],

  role: { 
    type: String, 
    enum: ["member"], 
    default: "member" 
  },

  bankDetails: {
    bankName: String,
    accountNumber: String,
    accountName: String
  },

  nextOfKin: {
    fullName: String,
    relationship: String,
    phone: String,
    address: String
  },

  guarantorRequests: [guarantorRequestSchema],

  guarantorRequestStats: {
    totalReceived: { type: Number, default: 0 },
    totalAccepted: { type: Number, default: 0 },
    totalDeclined: { type: Number, default: 0 },
    totalAmountApproved: { type: Number, default: 0 },
  },

  createdAt: { 
    type: Date, 
    default: Date.now 
  },

  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

module.exports = mongoose.model("User", userSchema);
