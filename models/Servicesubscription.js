const mongoose = require('mongoose');

// Service Schema - Defines available services (Domain, Email, etc.)
const serviceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  serviceKey: {
    type: String,
    required: true,
    unique: true,
    enum: ['domain', 'email', 'emailDelivery', 'database', 'server']
  },
  provider: {
    type: String,
    required: true,
    trim: true
  },
  price: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    required: true,
    enum: ['NGN', 'USD'],
    default: 'NGN'
  },
  billingPeriod: {
    type: String,
    required: true,
    enum: ['month', 'year'],
    default: 'year'
  },
  providerLink: {
    type: String,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
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

// Payment History Schema - Records individual payments
const paymentHistorySchema = new mongoose.Schema({
  service: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service',
    required: true
  },
  serviceName: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    required: true,
    enum: ['NGN', 'USD']
  },
  amountInNaira: {
    type: Number,
    required: true
  },
  exchangeRate: {
    type: Number,
    default: 1500
  },
  transactionReference: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  paymentDate: {
    type: Date,
    required: true
  },
  paymentMethod: {
    type: String,
    default: 'Bank Transfer'
  },
  bankDetails: {
    bankName: {
      type: String,
      default: 'OPAY'
    },
    accountNumber: {
      type: String,
      default: '6409765034'
    },
    accountName: {
      type: String,
      default: 'Techmayor Company Limited'
    }
  },
  status: {
    type: String,
    enum: ['Paid', 'Pending', 'Failed', 'Refunded'],
    default: 'Paid'
  },
  provider: {
    type: String,
    required: true
  },
  renewalPeriod: {
    startDate: {
      type: Date,
      required: true
    },
    endDate: {
      type: Date,
      required: true
    }
  },
  notes: {
    type: String,
    trim: true
  },
  recordedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
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

// Subscription Status Schema - Tracks current status of each service
const subscriptionStatusSchema = new mongoose.Schema({
  service: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service',
    required: true,
    unique: true
  },
  currentStatus: {
    type: String,
    enum: ['Active', 'Expiring Soon', 'Expired', 'Grace Period', 'Suspended'],
    default: 'Active'
  },
  lastPayment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PaymentHistory'
  },
  currentPeriodStart: {
    type: Date,
    required: true
  },
  currentPeriodEnd: {
    type: Date,
    required: true
  },
  nextRenewalDate: {
    type: Date,
    required: true
  },
  daysUntilRenewal: {
    type: Number
  },
  autoRenew: {
    type: Boolean,
    default: false
  },
  reminderSent: {
    type: Boolean,
    default: false
  },
  lastReminderDate: {
    type: Date
  },
  totalPayments: {
    type: Number,
    default: 0
  },
  totalAmountPaid: {
    type: Number,
    default: 0
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

// Update timestamps on save
serviceSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

paymentHistorySchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

subscriptionStatusSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  // Calculate days until renewal
  if (this.nextRenewalDate) {
    const today = new Date();
    const diffTime = this.nextRenewalDate - today;
    this.daysUntilRenewal = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    // Auto-update status based on days
    if (this.daysUntilRenewal < 0) {
      this.currentStatus = 'Expired';
    } else if (this.daysUntilRenewal <= 7) {
      this.currentStatus = 'Expiring Soon';
    } else if (this.daysUntilRenewal <= 30) {
      this.currentStatus = 'Active';
    }
  }
  
  next();
});

// Indexes for better query performance
paymentHistorySchema.index({ paymentDate: -1 });
paymentHistorySchema.index({ service: 1, paymentDate: -1 });
paymentHistorySchema.index({ transactionReference: 1 });
paymentHistorySchema.index({ status: 1 });

subscriptionStatusSchema.index({ nextRenewalDate: 1 });
subscriptionStatusSchema.index({ currentStatus: 1 });

const Service = mongoose.model('Service', serviceSchema);
const PaymentHistory = mongoose.model('PaymentHistory', paymentHistorySchema);
const SubscriptionStatus = mongoose.model('SubscriptionStatus', subscriptionStatusSchema);

module.exports = {
  Service,
  PaymentHistory,
  SubscriptionStatus
};