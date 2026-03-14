const express = require("express");
const router = express.Router();

const User = require("../models/User");
const Account = require("../models/Account");
const MemberType = require("../models/MemberType");
const Settings = require("../models/Settings");
const KiddiesAccount = require("../models/Kiddies/kiddiesAccount");
const KiddiesTransaction = require("../models/Kiddies/kiddiesTransaction");
const KiddiesPayment = require("../models/Kiddies/KiddiesPayment");
const Transaction = require("../models/Transaction");

// ─── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  return res.status(401).json({ status: false, message: "Unauthorized" });
}

// ─── Helper: generate unique kiddies account ID ───────────────────────────────
async function generateKiddiesID(shortCode = "KID") {
  const last = await KiddiesAccount.findOne({
    accountID: { $regex: `^${shortCode}` },
  }).sort({ createdAt: -1 });

  let next = 1;
  if (last && last.accountID) {
    const match = last.accountID.match(/\d+$/);
    if (match) next = parseInt(match[0]) + 1;
  }
  return `${shortCode}${String(next).padStart(3, "0")}`;
}
// ───────────────────────────────────────────────────────────────────
// GET /manage/kiddies-account  — parent dashboard
// ───────────────────────────────────────────────────────────────────
router.get("/manage/kiddies-account", async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.redirect("/login");

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).send("User not found");

    const kiddiesAccounts = await KiddiesAccount.find({ parent: req.user._id })
      .populate("account")
      .sort({ createdAt: -1 });

    const settings               = await Settings.getSettings();
    const kiddiesRegistrationFee = settings.registrationFees.kiddiesRegistrationFee;
    const memberTypes            = await MemberType.find({});

    // ── Total savings across ALL accounts (members + kiddies) ──
    const allMemberAccounts      = await Account.find({});
    const allMembersTotalSavings = allMemberAccounts.reduce(
      (sum, acc) => sum + Number(acc.balance || 0), 0
    );

    const parentAccount        = await Account.findOne({ ownerType: "User", ownerId: user._id });
    const parentAccountBalance = parentAccount ? (parentAccount.balance || 0) : 0;
    const companyAccount       = settings.companyAccount || {};

    return res.render("dashboard/user/kiddies", {
      user,
      kiddiesAccounts,
      kiddiesRegistrationFee,
      settings,
      memberTypes,
      allMembersTotalSavings,
      parentAccountBalance,
      companyAccount,
      query: req.query,
    });
  } catch (err) {
    console.error("Kiddies dashboard error:", err);
    return res.status(500).send("Server error");
  }
});
 
 
// ───────────────────────────────────────────────────────────────────
// POST /api/kiddies/create
// Creates a new kiddies account then handles payment via:
//   paymentMethod = "paystack"  → Paystack redirect
//   paymentMethod = "manual"    → Pending KiddiesPayment (paymentType: "registration")
//   paymentMethod = "account"   → Instant debit from parent's coop account
//
// { existingAccountId } re-triggers Paystack for an unpaid account.
// ───────────────────────────────────────────────────────────────────
router.post("/api/kiddies/create", async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ status: false, message: "Unauthorized" });
    }
 
    const user = await User.findById(req.user._id);
    const {
      paymentMethod = "paystack",
      payerName,
      existingAccountId,
      childFirstName,
      childLastName,
      childDOB,
      childGender,
      memberTypeId,
      initialDeposit,
      lockPeriodYears,
      beneficiaryType,
      nextOfKinFullName,
      nextOfKinPhone,
      nextOfKinEmail,
      nextOfKinRelationship,
      nextOfKinAddress,
      barNumber,
      lawFirm,
    } = req.body;
 
    const settings        = await Settings.getSettings();
    const registrationFee = settings.registrationFees.kiddiesRegistrationFee;
 
    // ── RE-TRIGGER: existing unpaid account → Paystack only ───────
    if (existingAccountId) {
      const kiddiesAccount = await KiddiesAccount.findOne({
        _id:    existingAccountId,
        parent: user._id,
      });
 
      if (!kiddiesAccount) {
        return res.status(404).json({ status: false, message: "Kiddies account not found." });
      }
      if (kiddiesAccount.registrationStatus === "paid") {
        return res.status(400).json({ status: false, message: "Registration already completed." });
      }
 
      const depositAmount = Number(kiddiesAccount.initialDeposit || 10000);
      const totalAmount   = registrationFee + depositAmount;
 
      const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
        method:  "POST",
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          email:        user.email,
          amount:       totalAmount * 100,
          metadata: {
            userId:           user._id,
            kiddiesAccountId: kiddiesAccount._id,
            type:             "kiddies_registration",
            childName:        `${kiddiesAccount.childFirstName} ${kiddiesAccount.childLastName}`,
            registrationFee,
            initialDeposit:   depositAmount,
          },
          callback_url: `${process.env.BASE_URL}/kiddies/payment/verify`,
        }),
      });
 
      const paystackData = await paystackRes.json();
      if (!paystackData.status || !paystackData.data) {
        return res.status(500).json({ status: false, message: "Payment initialization failed." });
      }
 
      await KiddiesPayment.create({
        kiddiesAccount:   kiddiesAccount._id,
        parent:           user._id,
        email:            user.email,
        amount:           totalAmount,
        reference:        paystackData.data.reference,
        payeeName:        null,
        paymentType:      "registration",
        status:           "pending",
        paystackResponse: paystackData.data,
      });
 
      return res.json({
        status:            true,
        message:           "Redirecting to payment...",
        authorization_url: paystackData.data.authorization_url,
        kiddiesAccountId:  kiddiesAccount._id,
      });
    }
 
    // ── NEW ACCOUNT: validate fields ──────────────────────────────
    if (
      !childFirstName || !childLastName || !childDOB || !childGender ||
      !beneficiaryType || !nextOfKinFullName || !nextOfKinPhone ||
      !nextOfKinEmail || !nextOfKinRelationship || !nextOfKinAddress
    ) {
      return res.status(400).json({ status: false, message: "All required fields must be filled." });
    }
 
    const depositAmount = parseFloat(initialDeposit) || 0;
    if (depositAmount < 10000) {
      return res.status(400).json({ status: false, message: "Minimum initial deposit is ₦10,000." });
    }
 
    let accountType = memberTypeId ? await MemberType.findById(memberTypeId) : null;
    if (!accountType) accountType = await MemberType.findOne({ isDefault: true });
    if (!accountType) {
      return res.status(500).json({ status: false, message: "No member type configured." });
    }
 
    const accountID      = await generateKiddiesID("KID");
    const kiddiesAccount = await KiddiesAccount.create({
      parent: user._id,
      accountID,
      childFirstName,
      childLastName,
      childDOB:      new Date(childDOB),
      childGender,
      beneficiaryType,
      nextOfKin: {
        fullName:     nextOfKinFullName,
        phone:        nextOfKinPhone,
        email:        nextOfKinEmail,
        relationship: nextOfKinRelationship,
        address:      nextOfKinAddress,
        barNumber:    barNumber || undefined,
        lawFirm:      lawFirm   || undefined,
      },
      initialDeposit:     depositAmount,
      lockPeriodYears:    Math.min(18, Math.max(5, parseInt(lockPeriodYears) || 5)),
      registrationStatus: "pending",
      status:             "locked",
    });
 
    const account = await Account.create({
      ownerType:       "KiddiesAccount",
      ownerId:         kiddiesAccount._id,
      accountType:     accountType._id,
      balance:         0,
      monthlyROI:      accountType.interestRate || 0,
      accumulativeROI: 0,
    });
 
    kiddiesAccount.account = account._id;
    await kiddiesAccount.save();
 
    await User.findByIdAndUpdate(user._id, {
      $push: { kiddiesAccounts: kiddiesAccount._id },
    });
 
    const totalAmount = registrationFee + depositAmount;
    const reference   = `KD-NEW-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
 
    // ── A. MANUAL ─────────────────────────────────────────────────
    if (paymentMethod === "manual") {
      await KiddiesPayment.create({
        kiddiesAccount:   kiddiesAccount._id,
        parent:           user._id,
        email:            user.email,
        amount:           totalAmount,
        reference,
        payeeName:        payerName?.trim() || null,
        paymentType:      "registration",
        status:           "pending",
        paystackResponse: null,
      });
 
      await KiddiesTransaction.create({
        kiddiesAccount: kiddiesAccount._id,
        parent:         user._id,
        type:           "deposit",
        amount:         depositAmount,
        balanceAfter:   0,
        description:    `Initial Deposit — Registration via Manual Transfer (Pending) — ${accountID}`,
        reference,
        status:         "pending",
        paymentMethod:  "cooperative",
      });
 
      console.log(`🕒 Kiddies manual registration pending: ₦${totalAmount} — ${user.email} → ${accountID}`);
 
      return res.status(200).json({
        status:  true,
        message: `Account created! Transfer ₦${totalAmount.toLocaleString()} (₦${registrationFee.toLocaleString()} fee + ₦${depositAmount.toLocaleString()} deposit) to our account. It will be activated after admin confirmation.`,
        kiddiesAccountId: kiddiesAccount._id,
      });
    }
 
    // ── B. FROM PARENT COOPERATIVE ACCOUNT ───────────────────────
    if (paymentMethod === "account") {
      const parentAccount = await Account.findOne({ ownerType: "User", ownerId: user._id });
 
      if (!parentAccount) {
        await KiddiesAccount.findByIdAndDelete(kiddiesAccount._id);
        await Account.findByIdAndDelete(account._id);
        await User.findByIdAndUpdate(user._id, { $pull: { kiddiesAccounts: kiddiesAccount._id } });
        return res.status(404).json({ status: false, message: "Your cooperative account was not found." });
      }
 
      if ((parentAccount.balance || 0) < totalAmount) {
        await KiddiesAccount.findByIdAndDelete(kiddiesAccount._id);
        await Account.findByIdAndDelete(account._id);
        await User.findByIdAndUpdate(user._id, { $pull: { kiddiesAccounts: kiddiesAccount._id } });
        return res.status(400).json({
          status:  false,
          message: `Insufficient balance. ₦${totalAmount.toLocaleString()} required (₦${registrationFee.toLocaleString()} fee + ₦${depositAmount.toLocaleString()} deposit). Your balance is ₦${parentAccount.balance.toLocaleString()}.`,
        });
      }
 
      parentAccount.balance -= totalAmount;
      await parentAccount.save();
 
      await Transaction.create({
        user:        user._id,
        type:        "withdrawal",
        amount:      totalAmount,
        status:      "successful",
        description: `Kiddies Account Registration — ${childFirstName} ${childLastName} (${accountID})`,
        reference,
        method:      "Internal Transfer",
      });
 
      account.balance = depositAmount;
      await account.save();
 
      await KiddiesTransaction.create({
        kiddiesAccount: kiddiesAccount._id,
        parent:         user._id,
        type:           "deposit",
        amount:         depositAmount,
        balanceAfter:   account.balance,
        description:    `Initial Deposit — Registration via Parent Cooperative Account`,
        reference,
        status:         "completed",
        paymentMethod:  "cooperative",
      });
 
      kiddiesAccount.registrationStatus = "paid";
      await kiddiesAccount.save();
 
      console.log(`✅ Kiddies registration via parent account: ₦${totalAmount} | ${user.email} → ${accountID} | Ref: ${reference}`);
 
      return res.status(200).json({
        status:           true,
        message:          `Account created! ${childFirstName}'s account is now pending admin approval.`,
        kiddiesAccountId: kiddiesAccount._id,
        newParentBalance: parentAccount.balance,
      });
    }
 
    // ── C. PAYSTACK (default) ─────────────────────────────────────
    const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
      method:  "POST",
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email:  user.email,
        amount: totalAmount * 100,
        metadata: {
          userId:           user._id,
          kiddiesAccountId: kiddiesAccount._id,
          type:             "kiddies_registration",
          childName:        `${childFirstName} ${childLastName}`,
          registrationFee,
          initialDeposit:   depositAmount,
        },
        callback_url: `${process.env.BASE_URL}/kiddies/payment/verify`,
      }),
    });
 
    const paystackData = await paystackRes.json();
    if (!paystackData.status || !paystackData.data) {
      await KiddiesAccount.findByIdAndDelete(kiddiesAccount._id);
      await Account.findByIdAndDelete(account._id);
      await User.findByIdAndUpdate(user._id, { $pull: { kiddiesAccounts: kiddiesAccount._id } });
      return res.status(500).json({ status: false, message: "Payment initialization failed." });
    }
 
    await KiddiesPayment.create({
      kiddiesAccount:   kiddiesAccount._id,
      parent:           user._id,
      email:            user.email,
      amount:           totalAmount,
      reference:        paystackData.data.reference,
      payeeName:        null,
      paymentType:      "registration",
      status:           "pending",
      paystackResponse: paystackData.data,
    });
 
    return res.json({
      status:            true,
      message:           "Account created. Redirecting to payment...",
      authorization_url: paystackData.data.authorization_url,
      kiddiesAccountId:  kiddiesAccount._id,
    });
 
  } catch (err) {
    console.error("Kiddies create error:", err);
    return res.status(500).json({ status: false, message: "Error creating kiddies account." });
  }
});
 
 
// ───────────────────────────────────────────────────────────────────
// POST /api/kiddies/register/manual
// Re-triggers registration for an existing unpaid account via manual
// bank transfer. KiddiesPayment paymentType = "registration".
// ───────────────────────────────────────────────────────────────────
router.post("/api/kiddies/register/manual", async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ status: false, message: "Unauthorized" });
    }
 
    const user                         = req.user;
    const { existingAccountId, payerName } = req.body;
 
    if (!existingAccountId) {
      return res.status(400).json({ status: false, message: "Account ID is required." });
    }
 
    const kiddiesAccount = await KiddiesAccount.findOne({
      _id:    existingAccountId,
      parent: user._id,
    }).populate("account");
 
    if (!kiddiesAccount) {
      return res.status(404).json({ status: false, message: "Kiddies account not found." });
    }
    if (kiddiesAccount.registrationStatus === "paid") {
      return res.status(400).json({ status: false, message: "Registration already completed." });
    }
 
    const settings        = await Settings.getSettings();
    const registrationFee = settings.registrationFees.kiddiesRegistrationFee;
    const depositAmount   = Number(kiddiesAccount.initialDeposit || 10000);
    const totalAmount     = registrationFee + depositAmount;
    const reference       = `KD-REG-MANUAL-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
 
    await KiddiesPayment.create({
      kiddiesAccount:   kiddiesAccount._id,
      parent:           user._id,
      email:            user.email,
      amount:           totalAmount,
      reference,
      payeeName:        payerName?.trim() || null,
      paymentType:      "registration",
      status:           "pending",
      paystackResponse: null,
    });
 
    await KiddiesTransaction.create({
      kiddiesAccount: kiddiesAccount._id,
      parent:         user._id,
      type:           "deposit",
      amount:         depositAmount,
      balanceAfter:   kiddiesAccount.account?.balance || 0,
      description:    `Initial Deposit — Registration via Manual Transfer (Pending) — ${kiddiesAccount.accountID}`,
      reference,
      status:         "pending",
      paymentMethod:  "cooperative",
    });
 
    console.log(`🕒 Kiddies manual registration pending: ₦${totalAmount} — ${user.email} → ${kiddiesAccount.accountID}`);
 
    return res.status(200).json({
      status:  true,
      message: `Transfer ₦${totalAmount.toLocaleString()} (₦${registrationFee.toLocaleString()} fee + ₦${depositAmount.toLocaleString()} deposit) to our account. It will be activated after admin confirmation.`,
    });
 
  } catch (err) {
    console.error("Kiddies manual registration error:", err);
    return res.status(500).json({ status: false, message: "Server error. Please try again." });
  }
});
 
 
// ───────────────────────────────────────────────────────────────────
// POST /api/kiddies/register/from-account
// Pays registration fee + initial deposit from parent's coop account.
// Marks registrationStatus = "paid" immediately.
// ───────────────────────────────────────────────────────────────────
router.post("/api/kiddies/register/from-account", async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ status: false, message: "Unauthorized" });
    }
 
    const user                  = req.user;
    const { existingAccountId } = req.body;
 
    if (!existingAccountId) {
      return res.status(400).json({ status: false, message: "Account ID is required." });
    }
 
    const parentAccount = await Account.findOne({ ownerType: "User", ownerId: user._id });
    if (!parentAccount) {
      return res.status(404).json({ status: false, message: "Your cooperative account was not found." });
    }
 
    const kiddiesAccount = await KiddiesAccount.findOne({
      _id:    existingAccountId,
      parent: user._id,
    }).populate("account");
 
    if (!kiddiesAccount) {
      return res.status(404).json({ status: false, message: "Kiddies account not found." });
    }
    if (kiddiesAccount.registrationStatus === "paid") {
      return res.status(400).json({ status: false, message: "Registration already completed." });
    }
 
    const settings               = await Settings.getSettings();
    const kiddiesRegistrationFee = settings.registrationFees.kiddiesRegistrationFee;
    const initialDeposit         = Number(kiddiesAccount.initialDeposit || 10000);
    const totalCharge            = kiddiesRegistrationFee + initialDeposit;
 
    if ((parentAccount.balance || 0) < totalCharge) {
      return res.status(400).json({
        status:  false,
        message: `Insufficient balance. ₦${totalCharge.toLocaleString()} required (₦${kiddiesRegistrationFee.toLocaleString()} fee + ₦${initialDeposit.toLocaleString()} deposit). Your balance is ₦${parentAccount.balance.toLocaleString()}.`,
      });
    }
 
    const reference = `KD-REG-ACCT-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
 
    parentAccount.balance -= totalCharge;
    await parentAccount.save();
 
    await Transaction.create({
      user:        user._id,
      type:        "withdrawal",
      amount:      totalCharge,
      status:      "successful",
      description: `Kiddies Account Registration — ${kiddiesAccount.childFirstName} ${kiddiesAccount.childLastName} (${kiddiesAccount.accountID})`,
      reference,
      method:      "Internal Transfer",
    });
 
    const kiddiesLinkedAccount = kiddiesAccount.account;
    if (kiddiesLinkedAccount) {
      kiddiesLinkedAccount.balance += initialDeposit;
      await kiddiesLinkedAccount.save();
 
      await KiddiesTransaction.create({
        kiddiesAccount: kiddiesAccount._id,
        parent:         user._id,
        type:           "deposit",
        amount:         initialDeposit,
        balanceAfter:   kiddiesLinkedAccount.balance,
        description:    `Initial Deposit — Registration via Parent Cooperative Account`,
        reference,
        status:         "completed",
        paymentMethod:  "cooperative",
      });
    }
 
    kiddiesAccount.registrationStatus = "paid";
    await kiddiesAccount.save();
 
    console.log(`✅ Kiddies registration via parent account: ₦${totalCharge} | ${user.email} → ${kiddiesAccount.accountID} | Ref: ${reference}`);
 
    return res.status(200).json({
      status:           true,
      message:          `Registration complete! ${kiddiesAccount.childFirstName}'s account is now pending admin approval.`,
      newParentBalance: parentAccount.balance,
    });
 
  } catch (err) {
    console.error("Kiddies registration via account error:", err);
    return res.status(500).json({ status: false, message: "Server error. Please try again." });
  }
});
 
 
// ───────────────────────────────────────────────────────────────────
// POST /api/kiddies/deposit/manual
// Pending top-up deposit via manual bank transfer.
// KiddiesPayment paymentType = "deposit".
// ───────────────────────────────────────────────────────────────────
router.post("/api/kiddies/deposit/manual", async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ status: false, message: "Unauthorized" });
    }
 
    const user          = req.user;
    const { kiddiesAccountId, amount, payerName } = req.body;
    const depositAmount = Number(amount);
 
    if (!kiddiesAccountId) {
      return res.status(400).json({ status: false, message: "Kiddies account is required." });
    }
    if (!depositAmount || isNaN(depositAmount) || depositAmount < 1000) {
      return res.status(400).json({ status: false, message: "Minimum deposit is ₦1,000." });
    }
 
    const kiddiesAccount = await KiddiesAccount.findOne({
      _id:    kiddiesAccountId,
      parent: user._id,
    }).populate("account");
 
    if (!kiddiesAccount) {
      return res.status(404).json({ status: false, message: "Kiddies account not found." });
    }
    if (kiddiesAccount.registrationStatus !== "paid") {
      return res.status(400).json({
        status:  false,
        message: "Account registration is not yet completed. Please pay the registration fee first.",
      });
    }
 
    const reference = `KD-MANUAL-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
 
    await KiddiesPayment.create({
      kiddiesAccount:   kiddiesAccount._id,
      parent:           user._id,
      email:            user.email,
      amount:           depositAmount,
      reference,
      payeeName:        payerName?.trim() || null,
      paymentType:      "deposit",
      status:           "pending",
      paystackResponse: null,
    });
 
    await KiddiesTransaction.create({
      kiddiesAccount: kiddiesAccount._id,
      parent:         user._id,
      type:           "deposit",
      amount:         depositAmount,
      balanceAfter:   kiddiesAccount.account?.balance || 0,
      description:    `Manual Deposit — Pending Admin Confirmation (${kiddiesAccount.accountID})`,
      reference,
      status:         "pending",
      paymentMethod:  "cooperative",
    });
 
    console.log(`🕒 Kiddies manual deposit pending: ₦${depositAmount} — ${user.email} → ${kiddiesAccount.accountID}`);
 
    return res.status(200).json({
      status:  true,
      message: "Deposit submitted. It will be credited to your child's account after admin confirmation.",
    });
 
  } catch (err) {
    console.error("Kiddies manual deposit error:", err);
    return res.status(500).json({ status: false, message: "Server error. Please try again." });
  }
});
 
 
// ───────────────────────────────────────────────────────────────────
// POST /api/kiddies/deposit/from-account
// Instantly debits parent's coop account and credits the child's
// kiddies account. No KiddiesPayment record needed — this is an
// internal transfer, not a payment gateway event.
//   Parent side  → Transaction        (cooperative schema)
//   Kiddies side → KiddiesTransaction (kiddies schema)
// ───────────────────────────────────────────────────────────────────
router.post("/api/kiddies/deposit/from-account", async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ status: false, message: "Unauthorized" });
    }
 
    const user          = req.user;
    const { kiddiesAccountId, amount } = req.body;
    const depositAmount = Number(amount);
 
    if (!kiddiesAccountId) {
      return res.status(400).json({ status: false, message: "Kiddies account is required." });
    }
    if (!depositAmount || isNaN(depositAmount) || depositAmount < 1000) {
      return res.status(400).json({ status: false, message: "Minimum deposit is ₦1,000." });
    }
 
    const parentAccount = await Account.findOne({ ownerType: "User", ownerId: user._id });
    if (!parentAccount) {
      return res.status(404).json({ status: false, message: "Your cooperative account was not found." });
    }
    if ((parentAccount.balance || 0) < depositAmount) {
      return res.status(400).json({
        status:  false,
        message: `Insufficient balance. Your balance is ₦${parentAccount.balance.toLocaleString()} but ₦${depositAmount.toLocaleString()} is required.`,
      });
    }
 
    const kiddiesAccount = await KiddiesAccount.findOne({
      _id:    kiddiesAccountId,
      parent: user._id,
    }).populate("account");
 
    if (!kiddiesAccount) {
      return res.status(404).json({ status: false, message: "Kiddies account not found." });
    }
    if (kiddiesAccount.registrationStatus !== "paid") {
      return res.status(400).json({
        status:  false,
        message: "Account registration is not yet completed. Please pay the registration fee first.",
      });
    }
 
    const kiddiesLinkedAccount = kiddiesAccount.account;
    if (!kiddiesLinkedAccount) {
      return res.status(400).json({
        status:  false,
        message: "This kiddies account has no linked savings account. Please contact support.",
      });
    }
 
    const reference = `KD-ACCT-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
 
    // Debit parent
    parentAccount.balance -= depositAmount;
    await parentAccount.save();
 
    await Transaction.create({
      user:        user._id,
      type:        "withdrawal",
      amount:      depositAmount,
      status:      "successful",
      description: `Transfer to Kiddies Account — ${kiddiesAccount.childFirstName} ${kiddiesAccount.childLastName} (${kiddiesAccount.accountID})`,
      reference,
      method:      "Internal Transfer",
    });
 
    // Credit kiddies
    kiddiesLinkedAccount.balance += depositAmount;
    await kiddiesLinkedAccount.save();
 
    await KiddiesTransaction.create({
      kiddiesAccount: kiddiesAccount._id,
      parent:         user._id,
      type:           "deposit",
      amount:         depositAmount,
      balanceAfter:   kiddiesLinkedAccount.balance,
      description:    `Deposit from Parent Cooperative Account — ${user.firstName} ${user.lastName}`,
      reference,
      status:         "completed",
      paymentMethod:  "cooperative",
    });
 
    console.log(`✅ Kiddies internal transfer: ₦${depositAmount} | ${user.email} → ${kiddiesAccount.accountID} | Ref: ${reference}`);
 
    return res.status(200).json({
      status:           true,
      message:          `₦${depositAmount.toLocaleString()} successfully transferred to ${kiddiesAccount.childFirstName}'s account.`,
      newParentBalance: parentAccount.balance,
    });
 
  } catch (err) {
    console.error("Kiddies account-to-account deposit error:", err);
    return res.status(500).json({ status: false, message: "Server error. Please try again." });
  }
});
 

// ══════════════════════════════════════════════════════════════════════════════
// GET /kiddies/payment/verify  — Paystack callback for kiddies registration
// ══════════════════════════════════════════════════════════════════════════════
router.get("/kiddies/payment/verify", async (req, res) => {
  const { reference } = req.query;
  if (!reference) return res.redirect("/manage/kiddies-account?payment=failed");

  try {
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const data = await verifyRes.json();
    if (!data.status || !data.data) {
      return res.redirect("/manage/kiddies-account?payment=failed");
    }

    const transaction = data.data;
    const payment = await KiddiesPayment.findOne({ reference }).populate(
      "kiddiesAccount"
    );

    if (!payment) {
      return res.redirect("/manage/kiddies-account?error=payment-not-found");
    }

    const isPaid = transaction.status === "success";

    payment.status = isPaid ? "success" : "failed";
    payment.paystackResponse = transaction;
    payment.verifiedAt = isPaid ? new Date() : null;
    await payment.save();

    if (isPaid && payment.kiddiesAccount) {
      const kiddiesAccount = payment.kiddiesAccount;
      const meta = transaction.metadata || {};

      // Update registration status
      kiddiesAccount.registrationStatus = "paid";
      // Status remains "locked" until admin approves
      await kiddiesAccount.save();

      // Credit the initial deposit to the sub-account
      const initialDeposit = meta.initialDeposit || 0;
      if (initialDeposit > 0 && kiddiesAccount.account) {
        await Account.findByIdAndUpdate(kiddiesAccount.account, {
          $inc: { balance: initialDeposit },
          updatedAt: new Date(),
        });

        const updatedAccount = await Account.findById(kiddiesAccount.account);

        // Record deposit transaction
        await KiddiesTransaction.create({
          kiddiesAccount: kiddiesAccount._id,
          parent: kiddiesAccount.parent,
          type: "deposit",
          amount: initialDeposit,
          balanceAfter: updatedAccount.balance,
          description: "Initial deposit on account creation",
          reference,
          status: "completed",
          paymentMethod: "paystack",
          paystackReference: reference,
        });
      }
    }

    if (isPaid) {
      return res.redirect(
        "/manage/kiddies-account?payment=success&message=Account+created+successfully.+Pending+admin+approval."
      );
    } else {
      return res.redirect("/manage/kiddies-account?payment=failed");
    }
  } catch (err) {
    console.error("Kiddies payment verify error:", err);
    return res.redirect("/manage/kiddies-account?payment=failed");
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/kiddies/deposit  — deposit into a kiddies account (Paystack)
// ══════════════════════════════════════════════════════════════════════════════
router.post("/api/kiddies/deposit", requireAuth, async (req, res) => {
  try {
    const { kiddiesAccountId, amount, paymentMethod } = req.body;

    if (!kiddiesAccountId || !amount || !paymentMethod) {
      return res
        .status(400)
        .json({ status: false, message: "Missing required fields." });
    }

    const depositAmount = parseFloat(amount);
    if (depositAmount < 1000) {
      return res.status(400).json({
        status: false,
        message: "Minimum deposit is ₦1,000.",
      });
    }

    const kiddiesAccount = await KiddiesAccount.findOne({
      _id: kiddiesAccountId,
      parent: req.user._id,
    });

    if (!kiddiesAccount) {
      return res
        .status(404)
        .json({ status: false, message: "Kiddies account not found." });
    }

    if (kiddiesAccount.registrationStatus !== "paid") {
      return res.status(400).json({
        status: false,
        message: "Account registration is not complete. Please pay the registration fee first.",
      });
    }

    const user = await User.findById(req.user._id);

    if (paymentMethod === "paystack") {
      const paystackRes = await fetch(
        "https://api.paystack.co/transaction/initialize",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: user.email,
            amount: depositAmount * 100,
            metadata: {
              userId: user._id,
              kiddiesAccountId: kiddiesAccount._id,
              type: "kiddies_deposit",
              childName: `${kiddiesAccount.childFirstName} ${kiddiesAccount.childLastName}`,
            },
            callback_url: `${process.env.BASE_URL}/kiddies/deposit/verify`,
          }),
        }
      );

      const paystackData = await paystackRes.json();
      if (!paystackData.status || !paystackData.data) {
        return res
          .status(500)
          .json({ status: false, message: "Payment initialization failed." });
      }

      // Save pending payment
      await KiddiesPayment.create({
        kiddiesAccount: kiddiesAccount._id,
        parent: user._id,
        email: user.email,
        amount: depositAmount,
        reference: paystackData.data.reference,
        status: "pending",
      });

      return res.json({
        status: true,
        authorization_url: paystackData.data.authorization_url,
      });
    }

    // ── Cooperative (manual) deposit ──
    if (paymentMethod === "cooperative") {
      const { payerName } = req.body;

      // Create a pending transaction; admin must approve
      const pendingTx = await KiddiesTransaction.create({
        kiddiesAccount: kiddiesAccount._id,
        parent: user._id,
        type: "deposit",
        amount: depositAmount,
        balanceAfter: 0, // updated on approval
        description: `Manual cooperative deposit${payerName ? ` by ${payerName}` : ""}`,
        status: "pending",
        paymentMethod: "cooperative",
      });

      return res.json({
        status: true,
        message: "Deposit request submitted. Pending admin confirmation.",
        transactionId: pendingTx._id,
      });
    }

    return res.status(400).json({ status: false, message: "Invalid payment method." });
  } catch (err) {
    console.error("Kiddies deposit error:", err);
    return res
      .status(500)
      .json({ status: false, message: "Deposit failed. Please try again." });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /kiddies/deposit/verify  — Paystack callback for deposits
// ══════════════════════════════════════════════════════════════════════════════
router.get("/kiddies/deposit/verify", async (req, res) => {
  const { reference } = req.query;
  if (!reference) return res.redirect("/manage/kiddies-account?payment=failed");

  try {
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      }
    );

    const data = await verifyRes.json();
    if (!data.status || !data.data) {
      return res.redirect("/manage/kiddies-account?payment=failed");
    }

    const transaction = data.data;
    const payment = await KiddiesPayment.findOne({ reference }).populate(
      "kiddiesAccount"
    );

    if (!payment) return res.redirect("/manage/kiddies-account?error=not-found");

    const isPaid = transaction.status === "success";
    payment.status = isPaid ? "success" : "failed";
    payment.paystackResponse = transaction;
    payment.verifiedAt = isPaid ? new Date() : null;
    await payment.save();

    if (isPaid && payment.kiddiesAccount) {
      const kid = payment.kiddiesAccount;

      // Credit account
      await Account.findByIdAndUpdate(kid.account, {
        $inc: { balance: payment.amount },
        updatedAt: new Date(),
      });

      const updatedAccount = await Account.findById(kid.account);

      await KiddiesTransaction.create({
        kiddiesAccount: kid._id,
        parent: kid.parent,
        type: "deposit",
        amount: payment.amount,
        balanceAfter: updatedAccount.balance,
        description: "Deposit via Paystack",
        reference,
        status: "completed",
        paymentMethod: "paystack",
        paystackReference: reference,
      });
    }

    return isPaid
      ? res.redirect("/manage/kiddies-account?payment=success")
      : res.redirect("/manage/kiddies-account?payment=failed");
  } catch (err) {
    console.error("Kiddies deposit verify error:", err);
    return res.redirect("/manage/kiddies-account?payment=failed");
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/kiddies/accounts  — list all kiddies accounts for logged-in user
// ══════════════════════════════════════════════════════════════════════════════
router.get("/api/kiddies/accounts", requireAuth, async (req, res) => {
  try {
    const accounts = await KiddiesAccount.find({ parent: req.user._id })
      .populate("account")
      .sort({ createdAt: -1 });

    return res.json({ status: true, accounts });
  } catch (err) {
    console.error("Kiddies accounts list error:", err);
    return res.status(500).json({ status: false, message: "Error fetching accounts." });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/kiddies/transactions/:accountId  — transactions for one kiddies account
// ══════════════════════════════════════════════════════════════════════════════
router.get("/api/kiddies/transactions/:accountId", requireAuth, async (req, res) => {
  try {
    const { accountId } = req.params;

    const kiddiesAccount = await KiddiesAccount.findOne({
      _id: accountId,
      parent: req.user._id,
    });

    if (!kiddiesAccount) {
      return res.status(404).json({ status: false, message: "Account not found." });
    }

    const transactions = await KiddiesTransaction.find({
      kiddiesAccount: accountId,
      status: { $ne: "failed" },
    }).sort({ createdAt: -1 });

    return res.json({ status: true, transactions });
  } catch (err) {
    console.error("Kiddies transactions error:", err);
    return res
      .status(500)
      .json({ status: false, message: "Error fetching transactions." });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/kiddies/account/:accountId  — single kiddies account details
// ══════════════════════════════════════════════════════════════════════════════
router.get("/api/kiddies/account/:accountId", requireAuth, async (req, res) => {
  try {
    const { accountId } = req.params;

    const kiddiesAccount = await KiddiesAccount.findOne({
      _id: accountId,
      parent: req.user._id,
    }).populate("account");

    if (!kiddiesAccount) {
      return res.status(404).json({ status: false, message: "Account not found." });
    }

    const transactions = await KiddiesTransaction.find({
      kiddiesAccount: accountId,
    })
      .sort({ createdAt: -1 })
      .limit(10);

    return res.json({ status: true, kiddiesAccount, transactions });
  } catch (err) {
    console.error("Kiddies account detail error:", err);
    return res.status(500).json({ status: false, message: "Error fetching account." });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PUT /api/kiddies/beneficiary/:accountId  — update next of kin
// ══════════════════════════════════════════════════════════════════════════════
router.put("/api/kiddies/beneficiary/:accountId", requireAuth, async (req, res) => {
  try {
    const { accountId } = req.params;
    const {
      fullName,
      phone,
      email,
      relationship,
      address,
      reason,
    } = req.body;

    const kiddiesAccount = await KiddiesAccount.findOne({
      _id: accountId,
      parent: req.user._id,
    });

    if (!kiddiesAccount) {
      return res.status(404).json({ status: false, message: "Account not found." });
    }

    // Update next of kin fields
    kiddiesAccount.nextOfKin = {
      ...kiddiesAccount.nextOfKin,
      fullName: fullName || kiddiesAccount.nextOfKin.fullName,
      phone: phone || kiddiesAccount.nextOfKin.phone,
      email: email || kiddiesAccount.nextOfKin.email,
      relationship: relationship || kiddiesAccount.nextOfKin.relationship,
      address: address || kiddiesAccount.nextOfKin.address,
    };

    kiddiesAccount.beneficiaryUpdateReason = reason;
    kiddiesAccount.updatedAt = new Date();
    await kiddiesAccount.save();

    return res.json({
      status: true,
      message: "Beneficiary update request submitted. Pending admin review.",
    });
  } catch (err) {
    console.error("Kiddies beneficiary update error:", err);
    return res
      .status(500)
      .json({ status: false, message: "Error updating beneficiary." });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/kiddies/summary  — aggregate stats for all kiddies accounts
// ══════════════════════════════════════════════════════════════════════════════
router.get("/api/kiddies/summary", requireAuth, async (req, res) => {
  try {
    const accounts = await KiddiesAccount.find({ parent: req.user._id }).populate(
      "account"
    );

    let totalSavings = 0;
    let totalInterest = 0;
    let earliestMaturity = null;

    for (const acc of accounts) {
      if (acc.account) {
        totalSavings += acc.account.balance || 0;
        totalInterest += acc.account.accumulativeROI || 0;
      }

      if (acc.unlockDate) {
        if (!earliestMaturity || acc.unlockDate < earliestMaturity) {
          earliestMaturity = acc.unlockDate;
        }
      }
    }

    return res.json({
      status: true,
      totalAccounts: accounts.length,
      totalSavings,
      totalInterest,
      earliestMaturity,
    });
  } catch (err) {
    console.error("Kiddies summary error:", err);
    return res.status(500).json({ status: false, message: "Error fetching summary." });
  }
});

module.exports = router;