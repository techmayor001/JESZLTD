const { Service, SubscriptionStatus } = require('./models/Servicesubscription');

// Initial services data
const servicesData = [
  {
    name: 'Domain Registration',
    serviceKey: 'domain',
    provider: 'Hostinger',
    price: 31206.92,
    currency: 'NGN',
    billingPeriod: 'year',
    providerLink: 'https://www.hostinger.com',
    description: 'clubdestars.com domain registration and renewal',
    isActive: true
  },
  {
    name: 'Email Hosting',
    serviceKey: 'email',
    provider: 'Hostinger',
    price: 23000,
    currency: 'NGN',
    billingPeriod: 'year',
    providerLink: 'https://www.hostinger.com',
    description: 'Business email hosting for info@jestltd.com',
    isActive: true
  },
  {
    name: 'Email Delivery Service',
    serviceKey: 'emailDelivery',
    provider: 'Postmark',
    price: 50,
    currency: 'USD',
    billingPeriod: 'year',
    providerLink: 'https://postmarkapp.com',
    description: 'Transactional email delivery service',
    isActive: true
  },
  {
    name: 'Database Hosting',
    serviceKey: 'database',
    provider: 'MongoDB Atlas',
    price: 7,
    currency: 'USD',
    billingPeriod: 'month',
    providerLink: 'https://www.mongodb.com/cloud/atlas',
    description: 'M10 Cluster database hosting',
    isActive: true
  },
  {
    name: 'Server Hosting',
    serviceKey: 'server',
    provider: 'Render',
    price: 7,
    currency: 'USD',
    billingPeriod: 'month',
    providerLink: 'https://render.com',
    description: 'Pro Plan server hosting',
    isActive: true
  }
];

// Initial subscription statuses (based on your provided dates)
const subscriptionStatusesData = [
  {
    serviceKey: 'domain',
    currentStatus: 'Active',
    currentPeriodStart: new Date('2025-11-05'),
    currentPeriodEnd: new Date('2026-11-05'),
    nextRenewalDate: new Date('2026-11-05')
  },
  {
    serviceKey: 'email',
    currentStatus: 'Active',
    currentPeriodStart: new Date('2026-01-20'),
    currentPeriodEnd: new Date('2027-01-20'),
    nextRenewalDate: new Date('2027-01-20')
  },
  {
    serviceKey: 'emailDelivery',
    currentStatus: 'Active',
    currentPeriodStart: new Date('2026-01-20'),
    currentPeriodEnd: new Date('2027-01-20'),
    nextRenewalDate: new Date('2027-01-20')
  },
  {
    serviceKey: 'database',
    currentStatus: 'Active',
    currentPeriodStart: new Date('2025-11-05'),
    currentPeriodEnd: new Date('2026-11-05'),
    nextRenewalDate: new Date('2026-11-05')
  },
  {
    serviceKey: 'server',
    currentStatus: 'Active',
    currentPeriodStart: new Date('2025-11-05'),
    currentPeriodEnd: new Date('2026-11-05'),
    nextRenewalDate: new Date('2026-11-05')
  }
];

/* ============================================================
   SEED SUBSCRIPTION SERVICES
============================================================ */
async function seedSubscriptionServices() {
  console.log("🔧 Seeding subscription services...");

  try {
    // Check if services already exist
    const existingServices = await Service.countDocuments();
    
    if (existingServices > 0) {
      console.log("⏭  Subscription services already exist, skipping...");
      return;
    }

    // Insert services
    const services = await Service.insertMany(servicesData);
    console.log(`✅ Inserted ${services.length} subscription services`);

    // Create subscription statuses
    for (const statusData of subscriptionStatusesData) {
      const service = services.find(s => s.serviceKey === statusData.serviceKey);
      
      if (service) {
        const status = new SubscriptionStatus({
          service: service._id,
          currentStatus: statusData.currentStatus,
          currentPeriodStart: statusData.currentPeriodStart,
          currentPeriodEnd: statusData.currentPeriodEnd,
          nextRenewalDate: statusData.nextRenewalDate,
          totalPayments: 0,
          totalAmountPaid: 0
        });
        
        await status.save();
        console.log(`  ✓ Status created for ${service.name}`);
      }
    }

    console.log("✅ Subscription services seeded successfully\n");

  } catch (error) {
    console.error('❌ Error seeding subscription services:', error);
    throw error;
  }
}

module.exports = seedSubscriptionServices;