const mongoose = require("mongoose");

const loanSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true 
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
    required: true
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
