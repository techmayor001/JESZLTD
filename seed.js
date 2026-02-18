const mongoose = require("mongoose");
const Permission = require("./models/Permission");
const Role = require("./models/Role");
require("dotenv").config();
const MemberType = require("./models/MemberType");
const seedSubscriptionServices = require('./seedSubscriptions');

/* ============================================================
   DEFAULT PERMISSIONS
============================================================ */
const defaultPermissions = [
  // Member Management
  { name: "view_members", description: "View member list and details", isSystemPermission: true },
  { name: "create_members", description: "Add new members", isSystemPermission: true },
  { name: "edit_members", description: "Modify member information", isSystemPermission: true },
  { name: "delete_members", description: "Remove members", isSystemPermission: true },
  { name: "approve_members", description: "Approve pending member applications", isSystemPermission: true },
  { name: "view_membertype", description: "View membership types", isSystemPermission: true },
  { name: "create_membertype", description: "Create new membership types", isSystemPermission: true },
  { name: "edit_membertype", description: "Edit existing membership types", isSystemPermission: true },
  { name: "delete_membertype", description: "Delete membership types", isSystemPermission: true },

  // Financial Operations
  { name: "view_transactions", description: "View all transactions", isSystemPermission: true },
  { name: "view_deposits", description: "View all deposits", isSystemPermission: true },
  { name: "process_deposits", description: "Handle deposits", isSystemPermission: true },
  { name: "manage_roi", description: "Distribute ROI", isSystemPermission: true },
  { name: "view_financial_reports", description: "Access financial reports", isSystemPermission: true },
  { name: "authorize_transactions", description: "Authorize financial transactions", isSystemPermission: true },
  { name: "view_withdrawals", description: "View withdrawal requests", isSystemPermission: true },
  { name: "approve_withdrawals", description: "Approve withdrawal requests", isSystemPermission: true },
  { name: "view_extracharges", description: "View extra charges", isSystemPermission: true },

  // Loan Management
  { name: "view_loans", description: "View loan applications", isSystemPermission: true },
  { name: "view_external_loans", description: "View external loan applications", isSystemPermission: true },
  { name: "approve_loans", description: "Approve or reject loans", isSystemPermission: true },
  { name: "edit_loans", description: "Modify loan terms", isSystemPermission: true },
  { name: "manage_loan_settings", description: "Configure loan parameters", isSystemPermission: true },
  { name: "process_loan_payments", description: "Process repayments", isSystemPermission: true },
  { name: "reject_loans", description: "Reject loan applications", isSystemPermission: true },
  { name: "issue_external_loans", description: "Issue external loans", isSystemPermission: true },
  { name: "create_loan_settings", description: "Create new loan settings", isSystemPermission: true },
  { name: "delete_loan_settings", description: "Delete loan settings", isSystemPermission: true },


  // Reports & Analytics
  { name: "view_reports", description: "Access system reports", isSystemPermission: true },
  { name: "generate_reports", description: "Generate custom reports", isSystemPermission: true },
  { name: "view_analytics", description: "Access analytics dashboard", isSystemPermission: true },
  { name: "export_data", description: "Export system data", isSystemPermission: true },

  // System Settings
  { name: "manage_settings", description: "Configure system settings", isSystemPermission: true },
  { name: "view_audit_logs", description: "Access audit logs", isSystemPermission: true },
  { name: "view_logs", description: "Access system logs", isSystemPermission: true },
  { name: "manage_membership_types", description: "Manage membership types", isSystemPermission: true },

  // Role Management
  { name: "manage_roles", description: "Create and edit roles", isSystemPermission: true },
  { name: "assign_roles", description: "Assign roles to users", isSystemPermission: true },
  { name: "promote_to_admin", description: "Promote users to admin", isSystemPermission: true },

  // Subscription Management
  { name: "view_subscriptions", description: "View subscription services and status", isSystemPermission: true },
  { name: "manage_subscriptions", description: "Manage subscriptions and record payments", isSystemPermission: true }
];

/* ============================================================
   SYSTEM INITIALIZER
============================================================ */
async function initSystem() {
  console.log("🔧 Initializing system...");

  await Promise.all([
  Role.syncIndexes(),
  Permission.syncIndexes(),
  MemberType.syncIndexes(),
]);


  /* =========================
     1️⃣ Seed Permissions
  ========================= */
  for (const perm of defaultPermissions) {
    await Permission.updateOne(
      { name: perm.name },
      { $setOnInsert: perm },
      { upsert: true }
    );
  }

  const permissions = await Permission.find();
  console.log(`✅ ${permissions.length} permissions ready`);

  /* =========================
     2️⃣ Seed Roles
  ========================= */

  // SUPERADMIN (always gets all permissions)
  await Role.updateOne(
    { name: "superadmin" },
    {
      $set: {
        description: "Full system access with all permissions",
        permissions: permissions.map(p => p._id),
        isSystemRole: true,
        isActive: true
      }
    },
    { upsert: true }
  );

  // MEMBER (created only if missing)
  await Role.updateOne(
    { name: "member" },
    {
      $setOnInsert: {
        description: "Default system member role",
        permissions: [],
        isSystemRole: true,
        isActive: true
      }
    },
    { upsert: true }
  );

  console.log("✅ Default roles ready (superadmin + member)");

  /* =========================
     3️⃣ Seed Default MemberType
  ========================= */

  const defaultType = await MemberType.findOne({ isDefault: true });

  if (!defaultType) {
    await MemberType.create({
      name: "NCDS",
      shortCode: "N",
      interestRate: 5,
      isDefault: true,

      forceWithdrawalPenalty: 2,
      loanRolloverRate: 3,
      loanPenaltyRate: 5,
      loanPenaltyType: "percentage",
      gracePeriodDays: 7,
      maxLoanAmount: 0,
      minDepositBeforeLoan: 0,
      loanToDepositRatio: 80,
      allowForcedWithdrawal: true,
      earlyWithdrawalPeriodMonths: 6,
      roiDistributionFrequency: "monthly",
      minimumBalanceForROI: 0,
    });

    console.log("✅ Default MemberType created");
  } else {
    console.log("⏭  Default MemberType already exists");
  }

  /* =========================
     4️⃣ Seed Subscription Services
  ========================= */
  try {
    await seedSubscriptionServices();
  } catch (error) {
    console.error("⚠️  Warning: Could not seed subscription services:", error.message);
    // Don't fail the entire init if subscriptions fail
  }

  console.log("🎉 System initialization completed\n");
}

module.exports = initSystem;