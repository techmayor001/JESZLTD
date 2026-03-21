const express = require("express");
const router = express.Router();
require("dotenv").config();
const mongoose = require("mongoose");

const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;

const bcrypt = require("bcrypt");
const saltRounds = 10;

const User = require("../models/User");
const Payment = require("../models/Payment");
const Account = require("../models/Account");
const Settings = require("../models/Settings");
const MemberType = require("../models/MemberType");
const ExtraCharge = require("../models/ExtraCharge");
const Role = require("../models/Role");
const Permission = require("../models/Permission");

const multer = require('multer');
const fs = require('fs');
const path = require('path')
const fetch = require("node-fetch");


// MULTER CONFIGURATIONs
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/media/uploads/')
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname)
    },
})

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png/;
  const ext = path.extname(file.originalname).toLowerCase();
  const mime = file.mimetype;
  if (allowedTypes.test(ext) && allowedTypes.test(mime)) {
    cb(null, true);
  } else {
    cb(new Error('Only .jpeg, .jpg, .png files are allowed'));
  }
};

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB

 });


router.post(
  "/signup",
  upload.fields([
    { name: "addressProof", maxCount: 1 },
    { name: "passportPhoto", maxCount: 1 },
    { name: "idFile", maxCount: 1 },
    { name: "signature", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const {
        firstName,
        lastName,
        email,
        phone,
        dob,
        state,
        lga,
        address,
        idType,
        idNumber,
        referralCode,
        password,
        paymentMethod, // ← ADD THIS
        payerName,     // ← ADD THIS
      } = req.body;

      const normalizedEmail = email.toLowerCase();

      // ── Check existing email ──────────────────────────────────────────────
      const existingUser = await User.findOne({ email: normalizedEmail });
      if (existingUser) {
        return res.status(400).json({
          status: false,
          message: "This email is already registered.",
        });
      }

      // ── Files ─────────────────────────────────────────────────────────────
      const addressProof  = req.files["addressProof"]?.[0]?.path;
      const passportPhoto = req.files["passportPhoto"]?.[0]?.path;
      const idFile        = req.files["idFile"]?.[0]?.path;
      const signature     = req.files["signature"]?.[0]?.path;

      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // ── Default member type ───────────────────────────────────────────────
      const defaultMemberType = await MemberType.findOne({ isDefault: true });
      if (!defaultMemberType) {
        return res.status(500).json({
          status: false,
          message: "Default member type not found",
        });
      }

      const settings = await Settings.getSettings();
      const registrationFee = settings.registrationFees.adultRegistrationFee;

      // ── Safe membership ID generator ──────────────────────────────────────
      const usersOfType = await User.find({
        membershipID: {
          $regex: `^${defaultMemberType.shortCode}\\d+$`,
        },
      }).select("membershipID");

      let maxNumber = 0;
      for (const u of usersOfType) {
        const match = u.membershipID?.match(/\d+$/);
        if (match) {
          const num = parseInt(match[0], 10);
          if (num > maxNumber) maxNumber = num;
        }
      }

      const membershipID =
        `${defaultMemberType.shortCode}${String(maxNumber + 1).padStart(4, "0")}`;

      const newReferralCode = membershipID;

      // ── Superadmin check ──────────────────────────────────────────────────
      const isSuperAdmin =
        normalizedEmail === process.env.SUPERADMIN_EMAIL?.toLowerCase();

      const superAdminRole = isSuperAdmin
        ? await Role.findOne({ name: "superadmin" })
        : null;

      const memberRole = !isSuperAdmin
        ? await Role.findOne({ name: "member" })
        : null;

      if (isSuperAdmin && !superAdminRole) {
        return res.status(500).json({
          status: false,
          message: "Superadmin role not configured.",
        });
      }

      if (!isSuperAdmin && !memberRole) {
        return res.status(500).json({
          status: false,
          message: "Member role not configured.",
        });
      }

      // ── Create user ───────────────────────────────────────────────────────
      const newUser = await User.create({
        firstName,
        lastName,
        email: normalizedEmail,
        phone,
        dob,
        state,
        lga,
        address,
        addressProof,
        passportPhoto,
        idType,
        idNumber,
        idFile,
        signature,
        membershipID,
        referralCode: newReferralCode,
        password: hashedPassword,
        status:             isSuperAdmin ? "active"  : "pending",
        registrationStatus: isSuperAdmin ? "paid"    : "pending",
        role: isSuperAdmin ? superAdminRole._id : memberRole._id,
      });

      // ── Handle referral ───────────────────────────────────────────────────
      if (referralCode && !isSuperAdmin) {
        const referringUser = await User.findOne({ referralCode });
        if (referringUser) {
          referringUser.referredUsers.push(newUser._id);
          await referringUser.save();
        }
      }

      // ── Auto login ────────────────────────────────────────────────────────
      req.login(newUser, (err) => {
        if (err) console.error("Auto-login error:", err);
      });

      // ── Create Account ────────────────────────────────────────────────────
      const account = await Account.create({
        ownerType:       "User",
        ownerId:         newUser._id,
        accountType:     defaultMemberType._id,
        balance:         0,
        monthlyROI:      defaultMemberType.interestRate || 0,
        accumulativeROI: 0,
      });

      newUser.account = account._id;
      await newUser.save();

      // ═══════════════════════════════════════════════════════════════════════
      // SUPERADMIN BYPASS
      // ═══════════════════════════════════════════════════════════════════════
      if (isSuperAdmin) {
        const payment = await Payment.create({
          user:       newUser._id,
          email:      normalizedEmail,
          amount:     0,
          reference:  `SUPERADMIN-${Date.now()}`,
          status:     "success",
          verifiedAt: new Date(),
        });

        newUser.Payment = payment._id;
        await newUser.save();

        return res.json({
          status:   true,
          message:  "Superadmin registered successfully",
          redirect: "/cds-cooperative/dashboard",
        });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // MANUAL BANK TRANSFER
      // ═══════════════════════════════════════════════════════════════════════
      if (paymentMethod === "manual") {
        if (!payerName || payerName.trim().length < 2) {
          return res.status(400).json({
            status:  false,
            message: "Payer name is required for manual transfers.",
          });
        }

        const reference = `MANUAL-REG-${newUser._id}-${Date.now()}`;

        const payment = await Payment.create({
          user:        newUser._id,
          email:       normalizedEmail,
          amount:      registrationFee,
          reference,
          payeeName:   payerName.trim(),
          paymentType: "registration_fee",
          status:      "pending",
        });

        newUser.Payment = payment._id;
        await newUser.save();

        return res.json({
          status:        true,
          manualPending: true,
          message:
            "Registration submitted. Your account will be activated within 30 minutes once your transfer is confirmed.",
        });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // PAYSTACK (default)
      // ═══════════════════════════════════════════════════════════════════════
      const paystackRes = await fetch(
        "https://api.paystack.co/transaction/initialize",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email:  normalizedEmail,
            amount: registrationFee * 100,
            metadata: {
              firstName,
              lastName,
              userId: newUser._id,
            },
            callback_url: `${process.env.BASE_URL}/payment/verify`,
          }),
        }
      );

      const data = await paystackRes.json();
      if (!data.status || !data.data)
        throw new Error("Payment initialization failed");

      const payment = await Payment.create({
        user:        newUser._id,
        email:       normalizedEmail,
        amount:      registrationFee,
        reference:   data.data.reference,
        paymentType: "registration_fee",
        status:      "pending",
      });

      newUser.Payment = payment._id;
      await newUser.save();

      return res.json({
        status:            true,
        authorization_url: data.data.authorization_url,
      });

    } catch (err) {
      console.error("Signup error:", err);
      res.status(500).json({
        status: false,
        message: "Error during registration.",
      });
    }
  }
);

// ========== VERIFY PAYMENT ==========
router.get("/payment/verify", async (req, res) => {
  const { reference } = req.query;

  if (!reference) return res.redirect("/signup?payment=failed");

  try {
    // Verify transaction with Paystack
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    });

    const data = await verifyRes.json();

    if (!data.status || !data.data) {
      console.error("Invalid Paystack response:", data);
      return res.redirect("/signup?payment=failed");
    }

    const transaction = data.data;

    // Find the payment and populate user
    const payment = await Payment.findOne({ reference }).populate("user");

    if (!payment) return res.redirect("/signup?error=payment-not-found");

    // Map Paystack 'success' to our schema 'paid'
    const isPaid = transaction.status === "success";

    payment.status = isPaid ? "success" : "failed";
    payment.paystackResponse = transaction;
    payment.verifiedAt = isPaid ? new Date() : null;
    await payment.save();

    // Update user registrationStatus
    if (payment.user) {
      payment.user.registrationStatus = isPaid ? "paid" : "failed";
      await payment.user.save();
    }

    // Redirect user accordingly
    if (isPaid) {
      return res.redirect("/login");
    } else {
      return res.redirect("/signup?payment=failed");
    }
  } catch (err) {
    console.error("Payment verification error:", err);
    res.redirect("/signup?payment=failed");
  }
});


router.post("/payment/registration/manual", async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ status: false, message: "Not authenticated." });
    }
 
    const { payerName } = req.body;
    if (!payerName || payerName.trim().length < 2) {
      return res.status(400).json({
        status: false,
        message: "Payer name is required.",
      });
    }
 
    // ── Load user ──────────────────────────────────────────────────
    const user = await User.findById(userId).populate("Payment");
    if (!user) {
      return res.status(404).json({ status: false, message: "User not found." });
    }
 
    // ── Guard: already paid ────────────────────────────────────────
    if (
      user.registrationStatus === "paid" ||
      (user.Payment && user.Payment.status === "paid")
    ) {
      return res.status(400).json({
        status: false,
        message: "Registration fee already paid.",
      });
    }
 
    // ── Guard: pending manual already exists ───────────────────────
    const existingPending = await Payment.findOne({
      user: userId,
      paymentType: "registration_fee",
      status: "pending",
    });
    if (existingPending) {
      return res.status(400).json({
        status: false,
        message:
          "A manual payment request is already pending admin confirmation. Please wait.",
      });
    }
 
    const settings = await Settings.getSettings();
    const registrationFee = settings.registrationFees.adultRegistrationFee;
 
    // ── Create a pending manual payment ───────────────────────────
    const reference = `MANUAL-REG-${userId}-${Date.now()}`;
 
    const payment = await Payment.create({
      user: userId,
      email: user.email,
      amount: registrationFee,
      reference,
      payeeName: payerName.trim(),
      paymentType: "registration_fee",
      status: "pending",
    });
 
    // ── Link payment to user (keeps parity with Paystack flow) ────
    user.Payment = payment._id;
    await user.save();
 
    return res.json({
      status: true,
      manualPending: true,
      message:
        "Manual payment request submitted. Your account will be activated once an admin confirms the transfer.",
    });
  } catch (err) {
    console.error("Manual registration payment error:", err);
    return res.status(500).json({
      status: false,
      message: "Something went wrong. Please try again.",
    });
  }
});


// MIGRATION 
router.post(
  "/add",
  upload.fields([
    { name: "addressProof", maxCount: 1 },
    { name: "passportPhoto", maxCount: 1 },
    { name: "idFile", maxCount: 1 },
    { name: "signature", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const {
        firstName,
        lastName,
        email,
        phone,
        dob,
        state,
        lga,
        address,
        idType,
        idNumber,
        password,
        openingBalance,
        accumulativeROI,
        memberTypeId,
        referralCode
      } = req.body;

      const normalizedEmail = email.toLowerCase();

      // ── Email check ───────────────────────────────────────────────────────
      if (await User.findOne({ email: normalizedEmail })) {
        return res.status(400).json({
          status: false,
          message: "Email already registered."
        });
      }

      // ── Files ─────────────────────────────────────────────────────────────
      const addressProof  = req.files["addressProof"]?.[0]?.path;
      const passportPhoto = req.files["passportPhoto"]?.[0]?.path;
      const idFile        = req.files["idFile"]?.[0]?.path;
      const signature     = req.files["signature"]?.[0]?.path;

      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // ── Member type ───────────────────────────────────────────────────────
      const memberType = await MemberType.findById(memberTypeId);
      if (!memberType) {
        return res.status(400).json({
          status: false,
          message: "Member type not found"
        });
      }

      // ── Safe membership ID generation ─────────────────────────────────────
      const usersOfType = await User.find({
        membershipID: { $regex: `^${memberType.shortCode}\\d+$` }
      }).select("membershipID");

      let maxNumber = 0;
      for (const u of usersOfType) {
        const match = u.membershipID?.match(/\d+$/);
        if (match) {
          const num = parseInt(match[0], 10);
          if (num > maxNumber) maxNumber = num;
        }
      }

      const membershipID =
        `${memberType.shortCode}${String(maxNumber + 1).padStart(4, "0")}`;

      // ── Role ──────────────────────────────────────────────────────────────
      const memberRole = await Role.findOne({ name: "member" });

      // ── Create user ───────────────────────────────────────────────────────
      const newUser = await User.create({
        firstName,
        lastName,
        email: normalizedEmail,
        phone,
        dob,
        state,
        lga,
        address,
        idType,
        idNumber,
        addressProof,
        passportPhoto,
        idFile,
        signature,
        membershipID,
        referralCode:       membershipID,
        password:           hashedPassword,
        status:             "active",
        registrationStatus: "paid",
        role:               memberRole?._id
      });

      // ── Handle referral linking ───────────────────────────────────────────
      if (referralCode) {
        const referringUser = await User.findOne({ referralCode });
        if (referringUser) {
          referringUser.referredUsers.push(newUser._id);
          await referringUser.save();
        }
      }

      // ── Create Account (ownerType: "User") ────────────────────────────────
      // ownerType is set to "User" so this account is correctly identified as
      // a regular member account and included in ROI distribution.
      const account = await Account.create({
        ownerType:       "User",
        ownerId:         newUser._id,
        accountType:     memberType._id,
        balance:         Number(openingBalance) || 0,
        monthlyROI:      memberType.interestRate || 0,
        accumulativeROI: Number(accumulativeROI) || 0
      });

      newUser.account = account._id;
      await newUser.save();

      return res.json({
        status:       true,
        message:      "Member migrated successfully",
        membershipID,
        user:         newUser
      });

    } catch (err) {
      console.error("Error adding member:", err);
      res.status(500).json({
        status:  false,
        message: "Error adding member."
      });
    }
  }
);
// ENDS 




router.post("/paystack/webhook", express.json(), async (req, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const hash = crypto
    .createHmac("sha512", secret)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (hash !== req.headers["x-paystack-signature"]) {
    return res.status(401).send("Invalid signature");
  }

  const event = req.body;

  if (event.event === "charge.success") {
    const reference = event.data.reference;
    const payment = await Payment.findOne({ reference }).populate("user");
    if (payment) {
      payment.status = "paid";
      payment.paystackResponse = event.data;
      await payment.save();

      const user = payment.user;
      user.status = "approved";
      await user.save();
    }
  }

  res.sendStatus(200);
});


// USER SIGN-UP LOGIC 

router.get("/forgot-password", (req, res) => {
  res.render("auth/recovery");
});

router.get("/login", async (req, res) => {
  try {
    // ── No session → plain login page ────────────────────────────
    if (!req.user) {
      return res.render("auth/login", {
        accountState: null,
        stateData:    {},
        error:        null,
        success:      null,
      });
    }

    const user = await User.findById(req.user._id).lean();

    if (!user) {
      return res.render("auth/login", {
        accountState: null,
        stateData:    {},
        error:        "Session expired. Please log in again.",
        success:      null,
      });
    }

    // ── Load settings (bank details + fee) ────────────────────────
    const settings        = await Settings.getSettings();
    const companyAccount  = settings.companyAccount;
    const registrationFee = settings.registrationFees.adultRegistrationFee;

    // ── Find latest registration-fee payment ──────────────────────
    const regPayment = await Payment.findOne({
      user:        user._id,
      paymentType: "registration_fee",
    })
      .sort({ createdAt: -1 })
      .lean();

    const hoursSince = regPayment
      ? (Date.now() - new Date(regPayment.createdAt).getTime()) / 36e5
      : null;

    const submittedAt = regPayment
      ? new Date(regPayment.createdAt).toLocaleString("en-NG", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : null;

    // ══════════════════════════════════════════════════════════════
    // CASE 1 — DELETED
    // ══════════════════════════════════════════════════════════════
    if (user.status === "deleted") {
      return res.render("auth/login", {
        accountState: "deleted",
        stateData:    {},
        error: null, success: null,
      });
    }

    // ══════════════════════════════════════════════════════════════
    // CASE 2 — SUSPENDED
    // ══════════════════════════════════════════════════════════════
    if (user.status === "suspended") {
      return res.render("auth/login", {
        accountState: "suspended",
        stateData:    {},
        error: null, success: null,
      });
    }

    // ══════════════════════════════════════════════════════════════
    // CASE 3 — DEACTIVATED  →  must re-pay registration fee
    // ══════════════════════════════════════════════════════════════
    if (user.status === "deactivated") {
      return res.render("auth/login", {
        accountState: "deactivated",
        stateData:    { companyAccount, registrationFee, userId: user._id.toString() },
        error: null, success: null,
      });
    }

    // ══════════════════════════════════════════════════════════════
    // CASE 4 — REJECTED
    // ══════════════════════════════════════════════════════════════
    if (user.status === "rejected") {
      return res.render("auth/login", {
        accountState: "rejected",
        stateData:    {},
        error: null, success: null,
      });
    }

    // ── From here: status is "pending" or "active" ────────────────

    // ══════════════════════════════════════════════════════════════
    // CASE 5 — ACTIVE  →  go to dashboard
    // ══════════════════════════════════════════════════════════════
    if (user.status === "active" && user.registrationStatus === "paid") {
      return res.redirect("/cds-cooperative/dashboard");
    }

    // ══════════════════════════════════════════════════════════════
    // CASE 6 — registrationStatus: "pending" + no payment record
    //           → never paid, redirect back to finish registration
    // ══════════════════════════════════════════════════════════════
    if (!regPayment) {
      return res.render("auth/login", {
        accountState: "no_payment",
        stateData:    { registrationFee },
        error: null, success: null,
      });
    }

    // ══════════════════════════════════════════════════════════════
    // CASE 7 — Payment exists but FAILED
    // ══════════════════════════════════════════════════════════════
    if (regPayment.status === "failed") {
      return res.render("auth/login", {
        accountState: "payment_failed",
        stateData:    { registrationFee },
        error: null, success: null,
      });
    }

    // ══════════════════════════════════════════════════════════════
    // CASE 8 — Payment PENDING admin approval
    //           sub-case: > 24 hrs since submission
    // ══════════════════════════════════════════════════════════════
    if (regPayment.status === "pending") {
      return res.render("auth/login", {
        accountState: "payment_pending",
        stateData: {
          over24hrs:     hoursSince > 24,
          submittedAt,
          paymentMethod: regPayment.payeeName ? "manual" : "paystack",
          companyAccount,
        },
        error: null, success: null,
      });
    }

    // ══════════════════════════════════════════════════════════════
    // CASE 9 — Payment PAID/SUCCESS but account still pending
    //           Admin confirmed payment but hasn't activated account
    // ══════════════════════════════════════════════════════════════
    if (
      (regPayment.status === "paid" || regPayment.status === "success") &&
      user.status === "pending"
    ) {
      return res.render("auth/login", {
        accountState: "account_pending",
        stateData:    {},
        error: null, success: null,
      });
    }

    // ── Fallback ──────────────────────────────────────────────────
    return res.render("auth/login", {
      accountState: null,
      stateData:    {},
      error:        null,
      success:      null,
    });

  } catch (err) {
    console.error("Login GET error:", err);
    res.render("auth/login", {
      accountState: null,
      stateData:    {},
      error:        "Something went wrong. Please try again.",
      success:      null,
    });
  }
});

// LOGIN ROUTE
router.post("/login", (req, res, next) => {
  passport.authenticate("user-local", async (err, user, info) => {

    // ── Server error ──────────────────────────────────────────────
    if (err) {
      return res.status(500).json({ success: false, error: "An error occurred. Please try again." });
    }

    // ── Wrong credentials ─────────────────────────────────────────
    if (!user) {
      let error = "Invalid email or password.";
      if (info?.message === "No user found")         error = "Email not found. Please register first.";
      else if (info?.message === "Incorrect password") error = "Incorrect password. Please try again.";
      else if (info?.message === "No role assigned")   error = "No role assigned. Contact support.";
      else if (info?.message === "User role is inactive") error = "Account role is inactive. Contact support.";
      return res.status(401).json({ success: false, error });
    }

    // ── Log the user in ───────────────────────────────────────────
    req.logIn(user, async (loginErr) => {
      if (loginErr) {
        return res.status(500).json({ success: false, error: "Login failed. Please try again." });
      }

      try {
        // ── Reload fresh user from DB ─────────────────────────────
        const freshUser = await User.findById(user._id).lean();
        if (!freshUser) {
          return res.status(404).json({ success: false, error: "User not found." });
        }

        // ── Load settings ─────────────────────────────────────────
        const settings        = await Settings.getSettings();
        const companyAccount  = settings.companyAccount;
        const registrationFee = settings.registrationFees.adultRegistrationFee;

        // ── Latest registration-fee payment ───────────────────────
        const regPayment = await Payment.findOne({
          user:        freshUser._id,
          paymentType: "registration_fee",
        })
          .sort({ createdAt: -1 })
          .lean();

        const hoursSince  = regPayment
          ? (Date.now() - new Date(regPayment.createdAt).getTime()) / 36e5
          : null;

        const submittedAt = regPayment
          ? new Date(regPayment.createdAt).toLocaleString("en-NG", {
              dateStyle: "medium",
              timeStyle: "short",
            })
          : null;

        // ══════════════════════════════════════════════════════════
        // STATUS CHECKS — return accountState + stateData as JSON
        // ══════════════════════════════════════════════════════════

        if (freshUser.status === "deleted") {
          return res.json({ success: true, accountState: "deleted", stateData: {} });
        }

        if (freshUser.status === "suspended") {
          return res.json({ success: true, accountState: "suspended", stateData: {} });
        }

        if (freshUser.status === "deactivated") {
          return res.json({
            success: true,
            accountState: "deactivated",
            stateData: { companyAccount, registrationFee, userId: freshUser._id.toString() },
          });
        }

        if (freshUser.status === "rejected") {
          return res.json({ success: true, accountState: "rejected", stateData: {} });
        }

        // ── Active + paid → go to dashboard ───────────────────────
        if (freshUser.status === "active" && freshUser.registrationStatus === "paid") {
          return res.json({ success: true, accountState: "dashboard" });
        }

        // ── No payment at all ─────────────────────────────────────
        if (!regPayment) {
          return res.json({
            success: true,
            accountState: "no_payment",
            stateData: { registrationFee },
          });
        }

        // ── Payment failed ────────────────────────────────────────
        if (regPayment.status === "failed") {
          return res.json({
            success: true,
            accountState: "payment_failed",
            stateData: { registrationFee },
          });
        }

        // ── Payment pending admin ─────────────────────────────────
        if (regPayment.status === "pending") {
          return res.json({
            success: true,
            accountState: "payment_pending",
            stateData: {
              over24hrs:     hoursSince > 24,
              submittedAt,
              paymentMethod: regPayment.payeeName ? "manual" : "paystack",
              companyAccount,
            },
          });
        }

        // ── Payment approved, account not yet activated ───────────
        if (
          (regPayment.status === "paid" || regPayment.status === "success") &&
          freshUser.status === "pending"
        ) {
          return res.json({ success: true, accountState: "account_pending", stateData: {} });
        }

        // ── Fallback → dashboard ──────────────────────────────────
        return res.json({ success: true, accountState: "dashboard" });

      } catch (checkErr) {
        console.error("Status check error:", checkErr);
        return res.status(500).json({ success: false, error: "Something went wrong. Please try again." });
      }
    });

  })(req, res, next);
});




// LOGOUT ROUTE 
router.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error("Logout error:", err);
      return res.redirect("/dashboard?error=logout_failed");
    }
    res.redirect("/login");
  });
});


// CHANGE PASSWORD ROUTE
router.post("/club-de-star-cooperative/changePassword", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ success: false, error: "Not authenticated" });

  const { password, newPassword } = req.body;

  try {
    const user = await User.findById(req.user._id)
      .populate("account")
      .populate("loans")
      .populate("referredUsers");

    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    // Check current password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.json({ success: false, error: "Current password is incorrect." });

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    return res.json({ success: true, message: "✅ Password changed successfully! You will be logged out in 5 seconds." });

  } catch (err) {
    console.error("Change password error:", err);
    return res.json({ success: false, error: "An error occurred. Please try again." });
  }
});


// EDIT PROFILE ROUTE 
router.post('/club-de-star-cooperative/updateProfile', async (req, res) => {
  if (!req.isAuthenticated()) 
    return res.status(401).json({ success: false, error: "Not authenticated" });

  const allowedFields = ['firstName', 'lastName', 'email', 'phone', 'dob', 'address'];

  try {
    const user = await User.findById(req.user._id);
    if (!user) 
      return res.status(404).json({ success: false, error: "User not found" });
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined && req.body[field] !== user[field]) {
        user[field] = req.body[field];
      }
    });

    await user.save();
    return res.json({ success: true, message: "Profile updated successfully!" });

  } catch (err) {
    console.error("Update profile error:", err);
    return res.json({ success: false, error: "Failed to update profile." });
  }
});


// EDIT PROFILE PICTURE ROUTE
router.post(
  '/club-de-star-cooperative/uploadAvatar',
  upload.single('avatar'),
  async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/login');

    try {
      const user = await User.findById(req.user._id);
      if (!user) return res.redirect('/login');

      if (!req.file) {
        // No file uploaded
        return res.redirect('/club-de-star-cooperative/profile?error=No file selected');
      }

      user.displayPicture = `/media/uploads/${req.file.filename}`;
      await user.save();

      res.redirect('/club-de-star-cooperative/profile?success=Avatar updated successfully');
    } catch (err) {
      console.error("Upload avatar error:", err);
      res.redirect('/club-de-star-cooperative/profile?error=Failed to upload avatar');
    }
  }
);


router.get("/club-de-star-cooperative/verifyBankAccount", async (req, res) => {
  if (!req.isAuthenticated()) 
    return res.json({ success: false, error: "Not authenticated" });

  const { bank, accountNumber } = req.query;

  if (!bank || !accountNumber)
    return res.json({ success: false, error: "Bank and account number are required" });

  try {
    const bankCodes = {
      "Access Bank": "044",
      "Citibank Nigeria": "023",
      "Ecobank Nigeria": "050",
      "Fidelity Bank": "070",
      "First Bank of Nigeria": "011",
      "FCMB": "214",
      "GTB": "058",
      "Guaranty Trust Bank (GTB)": "058",
      "Heritage Bank": "030",
      "Keystone Bank": "082",
      "Providus Bank": "101",
      "Polaris Bank": "076",
      "Stanbic IBTC Bank": "221",
      "Standard Chartered Bank": "068",
      "Sterling Bank": "232",
      "Union Bank of Nigeria": "032",
      "UBA": "033",
      "Unity Bank": "215",
      "Wema Bank": "035",
      "Zenith Bank": "057",

      // Digital banks
      "Opay": "999991", 
      "Kuda Bank": "50211",
      "Rubies Bank": "125",
      "VFD Microfinance Bank": "566",
      "Moniepoint": "150",
      "PalmPay": "999992"
    };

    const bankCode = bankCodes[bank];
    if (!bankCode) return res.json({ success: false, error: "Unsupported bank" });

    const url = `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json"
      }
    });

    const data = await response.json();

    if (data.status) {
      return res.json({ success: true, accountName: data.data.account_name });
    } else {
      return res.json({ success: false, error: data.message });
    }

  } catch (err) {
    console.error(err);
    return res.json({ success: false, error: "Verification failed" });
  }
});

// UPDATE BANK DETAILS
router.post("/club-de-star-cooperative/updateBankDetails", async (req, res) => {
    try {
        const { bankName, accountNumber, accountName } = req.body;

        // Validate
        if (!bankName || !accountNumber || !accountName) {
            return res.status(400).json({ success: false, message: "All fields are required." });
        }

        if (accountNumber.length !== 10) {
            return res.status(400).json({ success: false, message: "Account number must be 10 digits." });
        }

        // Get logged-in user
        const userId = req.user?._id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized." });
        }

        // Update MongoDB
        await User.findByIdAndUpdate(userId, {
            bankDetails: {
                bankName,
                accountNumber,
                accountName
            }
        });
        return res.redirect("/club-de-star-cooperative/profile");

    } catch (err) {
        console.error("Error updating bank details:", err);
        return res.status(500).json({
            success: false,
            message: "Server error updating bank details."
        });
    }
});




router.post(
  "/kyc/submit",
  upload.fields([
    { name: "addressProof", maxCount: 1 },
    { name: "passportPhoto", maxCount: 1 },
    { name: "idFile", maxCount: 1 },
    { name: "signature", maxCount: 1 },
  ]),
  async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ status: false, message: "Not authenticated." });
    }

    try {
      const { idType, idNumber } = req.body;

      // Validate required fields
      if (!idType || !idNumber) {
        return res.status(400).json({ status: false, message: "ID type and ID number are required." });
      }

      const user = await User.findById(req.user._id);
      if (!user) {
        return res.status(404).json({ status: false, message: "User not found." });
      }

      // Build update object — only overwrite fields if a new file was uploaded
      const updates = { idType, idNumber };

      if (req.files["addressProof"]?.[0]) {
        // Optionally delete old file
        if (user.addressProof) {
          fs.unlink(path.resolve(user.addressProof), (err) => {
            if (err) console.warn("Could not delete old addressProof:", err.message);
          });
        }
        updates.addressProof = req.files["addressProof"][0].path;
      }

      if (req.files["passportPhoto"]?.[0]) {
        if (user.passportPhoto) {
          fs.unlink(path.resolve(user.passportPhoto), (err) => {
            if (err) console.warn("Could not delete old passportPhoto:", err.message);
          });
        }
        updates.passportPhoto = req.files["passportPhoto"][0].path;
      }

      if (req.files["idFile"]?.[0]) {
        if (user.idFile) {
          fs.unlink(path.resolve(user.idFile), (err) => {
            if (err) console.warn("Could not delete old idFile:", err.message);
          });
        }
        updates.idFile = req.files["idFile"][0].path;
      }

      if (req.files["signature"]?.[0]) {
        if (user.signature) {
          fs.unlink(path.resolve(user.signature), (err) => {
            if (err) console.warn("Could not delete old signature:", err.message);
          });
        }
        updates.signature = req.files["signature"][0].path;
      }

      await User.findByIdAndUpdate(req.user._id, updates);

      return res.json({ status: true, message: "KYC documents submitted successfully." });

    } catch (err) {
      console.error("KYC submission error:", err);
      return res.status(500).json({ status: false, message: "Server error. Please try again." });
    }
  }
);

module.exports = router;