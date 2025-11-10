const express = require("express");
const router = express.Router();
const Payment = require("../models/Payment");
const Account = require("../models/Account");
const User = require("../models/User");
const Transaction = require("../models/Transaction");

// Initialize Deposit
router.post("/deposit/init", async (req, res) => {
  try {
    // Must be logged in
    if (!req.isAuthenticated()) {
      return res.status(401).json({ status: false, message: "You must be logged in to make a deposit." });
    }

    const { amount } = req.body;
    const user = req.user;

    if (!amount || amount <= 0) {
      return res.status(400).json({ status: false, message: "Invalid amount entered." });
    }

    // ✅ Initialize Paystack payment (same pattern as signup)
    const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: user.email,
        amount: amount * 100, // Convert ₦ to kobo
        metadata: { userId: user._id, type: "deposit" },
        callback_url: `${process.env.BASE_URL}/deposit/verify`,
      }),
    });

    const data = await paystackRes.json();
    if (!data.status || !data.data) throw new Error("Failed to initialize payment with Paystack.");

    // ✅ Record deposit in Payment collection
    await Payment.create({
      user: user._id,
      email: user.email,
      amount: amount * 100,
      reference: data.data.reference,
      status: "pending",
    });

    // ✅ Return Paystack redirect URL
    res.json({ status: true, authorization_url: data.data.authorization_url });
  } catch (err) {
    console.error("Deposit initialization error:", err);
    res.status(500).json({ status: false, message: "Error initializing deposit." });
  }
});



// Verify Deposit
router.get("/deposit/verify", async (req, res) => {
  const { reference } = req.query;

  if (!reference) return res.redirect("/club-de-star-cooperative/dashboard?deposit=failed");

  try {
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    });

    const data = await verifyRes.json();
    if (!data.status || !data.data) {
      console.error("Invalid Paystack response:", data);
      return res.redirect("/club-de-star-cooperative/dashboard?deposit=failed");
    }

    const transaction = data.data;
    const payment = await Payment.findOne({ reference }).populate("user");
    if (!payment) return res.redirect("/club-de-star-cooperative/dashboard?deposit=not-found");

    payment.status = transaction.status === "success" ? "paid" : "failed";
    payment.paystackResponse = transaction;
    await payment.save();

    if (payment.status === "paid") {
      let account = await Account.findOne({ user: payment.user._id });

      if (!account) {
        console.warn(`No account found for ${payment.user.email}, creating one.`);
        account = await Account.create({
          user: payment.user._id,
          accountType: payment.user.membershipID?.startsWith("CD") ? "CD" : "NCD",
          balance: 0,
          interestRate: payment.user.membershipID?.startsWith("CD") ? 5 : 10,
        });
      }

      const depositAmount = payment.amount / 100;
      account.balance += depositAmount;
      await account.save();

      await Transaction.create({
        user: payment.user._id,
        type: "deposit",
        amount: depositAmount,
        description: `Deposit via Paystack (Ref: ${reference})`,
      });

      console.log(`✅ Deposit recorded: ₦${depositAmount} for ${payment.user.email}`);
      return res.redirect("/club-de-star-cooperative/dashboard?deposit=success");
    } else {
      return res.redirect("/club-de-star-cooperative/dashboard?deposit=failed");
    }
  } catch (err) {
    console.error("Deposit verification error:", err);
    res.redirect("/club-de-star-cooperative/dashboard?deposit=failed");
  }
});

module.exports = router;
