const mongoose = require("mongoose");

const userSchema = mongoose.Schema({
  firstName: {
    type: String,
    required: true,
  },

  lastName: {
    type: String,
    required: true,
  },

  email: {
    type: String,
    required: true,
  },

  phone: {
    type: String,
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
    required: true,
  },
   
  idNumber: {
    type: String,
  },

  idFile: {
    type: String,
    required: true,
  },

  signature: {
    type: String,
    required: true,
  },

  Payment: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" },

  loans: [
    { type: mongoose.Schema.Types.ObjectId, ref: "Loan" }
  ],

  account: { type: mongoose.Schema.Types.ObjectId, ref: "Account" },

  status: {
    type: String,
    enum: ["pending", "active", "rejected"],
    default: "pending",
  },

  referralCode: {
    type: String,
    required: true,
  },

  membershipID: {
    type: String,
  },

  password: {
    type: String,
    required: true
  },

  referredUsers: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],

  role: {
    type: String,
    enum: ["member"],
    default: "member",
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },

  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("User", userSchema);
