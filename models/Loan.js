const mongoose = require("mongoose");

const loanSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
  },

  // External borrower
  external: {
    borrowerType: {
      type: String,
      enum: ["company", "individual"]
    },

    borrowerName: {
      type: String,
      trim: true
    },

    email: {
      type: String,
      lowercase: true,
      trim: true
    },

    phone: {
      type: String,
      trim: true
    },

    address: {
      type: String,
      trim: true
    }
  },

  initiatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin",
  },

  amount: { 
    type: Number, 
    required: true 
  },

  totalRepay: { 
    type: Number, 
    required: true 
  },

  interestRate: { 
    type: Number, 
    required: true 
  },

  duration: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "LoanSettings",
  },

  externalDuration: { 
    type: Number 
  },

  dueDate: {
    type: Date
  },

  guarantors: [
    {
      guarantor: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "User", 
        required: true 
      },
      status: { 
        type: String, 
        enum: ["pending", "accepted", "declined"], 
        default: "pending" 
      },
      respondedAt: { 
        type: Date 
      }
    }
  ],

  status: { 
    type: String, 
    enum: ["pending", "approved", "rejected", "paid"], 
    default: "pending" 
  },

  createdAt: { 
    type: Date, 
    default: Date.now 
  },

  updatedAt: { 
    type: Date, 
    default: Date.now 
  },
});

module.exports = mongoose.model("Loan", loanSchema);
