const mongoose = require("mongoose");

/* ============================================================
   GUARANTOR REQUEST SUB-SCHEMA
============================================================ */
const guarantorRequestSchema = new mongoose.Schema(
  {
    borrower: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    loan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Loan",
    },

    amount: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: ["pending", "accepted", "declined"],
      default: "pending",
    },

    respondedAt: {
      type: Date,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

/* ============================================================
   USER SCHEMA
============================================================ */
const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
    },

    lastName: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    phone: {
      type: String,
      trim: true,
    },

    dob: {
      type: Date,
    },

    state: String,
    lga: String,
    address: String,

    addressProof: String,
    passportPhoto: String,

    idType: {
      type: String,
      enum: ["nin", "passport", "drivers", "voters"],
    },

    idNumber: String,
    idFile: String,
    signature: String,
    displayPicture: String,

    // ── Official signature (used when this user holds the "chairman" role) ──
    officialSignature: {
      url: { type: String, default: null },
      updatedAt: { type: Date, default: null },
    },

    /* ============================================================
       RBAC: ROLE REFERENCE (NEW)
    ============================================================ */
    role: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
    },

    /* ============================================================
       RELATIONSHIPS
    ============================================================ */
    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
    },

    loans: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Loan",
      },
    ],

    // In userSchema, alongside the loans array:
    rolloverBlocked: {
      type: Boolean,
      default: false
    },

    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
    },

    kiddiesAccounts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "KiddiesAccount",
      },
    ],

    referredUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    /* ============================================================
       STATUS TRACKING
    ============================================================ */
    registrationStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },

    status: {
      type: String,
      enum: ["pending", "active", "rejected", "suspended", "deactivated", "deleted"],
      default: "pending",
    },

    referralCode: String,
    membershipID: {
      type: String,
      unique: true,
      sparse: true
    },

    password: {
      type: String,
      required: true,
      select: false,
    },

    /* ============================================================
       BANK & NEXT OF KIN
    ============================================================ */
    bankDetails: {
      bankName: String,
      accountNumber: String,
      accountName: String,
    },

    nextOfKin: {
      fullName: String,
      relationship: String,
      phone: String,
      address: String,
    },

    /* ============================================================
       GUARANTOR SYSTEM
    ============================================================ */
    guarantorRequests: [guarantorRequestSchema],

    guarantorRequestStats: {
      totalReceived: { type: Number, default: 0 },
      totalAccepted: { type: Number, default: 0 },
      totalDeclined: { type: Number, default: 0 },
      totalAmountApproved: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true, // ✅ automatically handles createdAt & updatedAt
  }
);

/* ============================================================
   EXPORT
============================================================ */
module.exports = mongoose.model("User", userSchema);
