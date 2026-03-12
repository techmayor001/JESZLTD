const express = require("express");
const router = express.Router();

const User = require("../models/User");
const Account = require("../models/Account");
const MemberType = require("../models/MemberType");
const Settings = require("../models/Settings");
const KiddiesAccount = require("../models/Kiddies/kiddiesAccount");
const KiddiesTransaction = require("../models/Kiddies/kiddiesTransaction");
const KiddiesPayment = require("../models/Kiddies/KiddiesPayment");

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

// ══════════════════════════════════════════════════════════════════════════════
// GET  /manage/kiddies-account  — render kiddies dashboard
// ══════════════════════════════════════════════════════════════════════════════
router.get("/manage/kiddies-account", async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.redirect("/login");

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).send("User not found");

    const kiddiesAccounts = await KiddiesAccount.find({ parent: req.user._id })
      .populate("account")
      .sort({ createdAt: -1 });

    const settings = await Settings.getSettings();
    const kiddiesRegistrationFee = settings.registrationFees.kiddiesRegistrationFee;
    const memberTypes = await MemberType.find({});

    // Total savings across all regular member accounts (same as main dashboard)
    const allMemberAccounts = await Account.find({ ownerType: "User" });
    const allMembersTotalSavings = allMemberAccounts.reduce(
      (sum, acc) => sum + Number(acc.balance || 0), 0
    );

    const companyAccount = settings.companyAccount || {};

    return res.render("dashboard/user/kiddies", {
      user,
      kiddiesAccounts,
      kiddiesRegistrationFee,
      settings,
      memberTypes,
      allMembersTotalSavings,  // ← share % calculation
      companyAccount,          // ← manual deposit bank details
      query: req.query,        // ← payment success/failed banners
    });
  } catch (err) {
    console.error("Kiddies dashboard error:", err);
    return res.status(500).send("Server error");
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/kiddies/create  — create a new kiddies account → init Paystack
// ══════════════════════════════════════════════════════════════════════════════
router.post("/api/kiddies/create", requireAuth, async (req, res) => {
  try {
    const {
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

    // ── Validate required fields ──
    if (
      !childFirstName ||
      !childLastName ||
      !childDOB ||
      !childGender ||
      !beneficiaryType ||
      !nextOfKinFullName ||
      !nextOfKinPhone ||
      !nextOfKinEmail ||
      !nextOfKinRelationship ||
      !nextOfKinAddress
    ) {
      return res
        .status(400)
        .json({ status: false, message: "All required fields must be filled." });
    }

    // ── Validate initial deposit ──
    const depositAmount = parseFloat(initialDeposit) || 0;
    if (depositAmount < 10000) {
      return res.status(400).json({
        status: false,
        message: "Minimum initial deposit is ₦10,000.",
      });
    }

    // ── Resolve member type ──
    let accountType;
    if (memberTypeId) {
      accountType = await MemberType.findById(memberTypeId);
    }
    if (!accountType) {
      accountType = await MemberType.findOne({ isDefault: true });
    }
    if (!accountType) {
      return res
        .status(500)
        .json({ status: false, message: "No member type configured." });
    }

    const settings = await Settings.getSettings();
    const registrationFee = settings.registrationFees.kiddiesRegistrationFee;
    const user = await User.findById(req.user._id);

    // ── Generate accountID ──
    const accountID = await generateKiddiesID("KID");

    // ── 1️⃣ Create KiddiesAccount first (no account ref yet) ──────────────────
    const kiddiesAccount = await KiddiesAccount.create({
      parent: user._id,
      accountID,
      childFirstName,
      childLastName,
      childDOB: new Date(childDOB),
      childGender,
      beneficiaryType,
      nextOfKin: {
        fullName: nextOfKinFullName,
        phone: nextOfKinPhone,
        email: nextOfKinEmail,
        relationship: nextOfKinRelationship,
        address: nextOfKinAddress,
        barNumber: barNumber || undefined,
        lawFirm: lawFirm || undefined,
      },
      initialDeposit: depositAmount,
      lockPeriodYears: Math.min(18, Math.max(5, parseInt(lockPeriodYears) || 5)),
      registrationStatus: "pending",
      status: "locked",
    });

    // ── 2️⃣ Create Account linked to KiddiesAccount ───────────────────────────
    // ownerType "KiddiesAccount" ensures this account is never treated as a
    // regular member account and is correctly handled in ROI distribution.
    const account = await Account.create({
      ownerType:       "KiddiesAccount",
      ownerId:         kiddiesAccount._id,
      accountType:     accountType._id,
      balance:         0,
      monthlyROI:      accountType.interestRate || 0,
      accumulativeROI: 0,
    });

    // ── 3️⃣ Link account back to KiddiesAccount ───────────────────────────────
    kiddiesAccount.account = account._id;
    await kiddiesAccount.save();

    // ── Link KiddiesAccount to parent user ────────────────────────────────────
    await User.findByIdAndUpdate(user._id, {
      $push: { kiddiesAccounts: kiddiesAccount._id },
    });

    // ── Init Paystack for registration fee + initial deposit ──────────────────
    const totalAmount = registrationFee + depositAmount;

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
      }
    );

    const paystackData = await paystackRes.json();
    if (!paystackData.status || !paystackData.data) {
      // ── Rollback all created documents on Paystack failure ────────────────
      await KiddiesAccount.findByIdAndDelete(kiddiesAccount._id);
      await Account.findByIdAndDelete(account._id);
      await User.findByIdAndUpdate(user._id, {
        $pull: { kiddiesAccounts: kiddiesAccount._id },
      });
      return res
        .status(500)
        .json({ status: false, message: "Payment initialization failed." });
    }

    // ── Save payment record ───────────────────────────────────────────────────
    await KiddiesPayment.create({
      kiddiesAccount: kiddiesAccount._id,
      parent:         user._id,
      email:          user.email,
      amount:         totalAmount,
      reference:      paystackData.data.reference,
      status:         "pending",
    });

    return res.json({
      status:            true,
      message:           "Account created. Redirecting to payment...",
      authorization_url: paystackData.data.authorization_url,
      kiddiesAccountId:  kiddiesAccount._id,
    });

  } catch (err) {
    console.error("Kiddies create error:", err);
    return res
      .status(500)
      .json({ status: false, message: "Error creating kiddies account." });
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