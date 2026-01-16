const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true 
  },

  email: { 
    type: String, 
    required: true 
  },

  loanId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Loan" 
  },

  amount: { 
    type: Number, 
    required: true 
  },

  reference: { 
    type: String, 
    required: true, 
    unique: true 
  },

  /* 👇 NEW FIELD */
  payeeName: { 
    type: String,
    trim: true,
    default: null
  },

  status: {
    type: String,
    enum: ["pending", "paid", "failed", "success"],
    default: "pending",
  },

  paystackResponse: { 
    type: Object 
  },

  createdAt: { 
    type: Date, 
    default: Date.now 
  },
});

module.exports = mongoose.model("Payment", paymentSchema);
