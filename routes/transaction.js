const express = require("express");
const router = express.Router();
const Payment = require("../models/Payment");
const Account = require("../models/Account");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Loan = require("../models/Loan");


router.post("/deposit/init", async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ status: false, message: "You must be logged in to make a deposit." });
    }

    const { amount } = req.body;
    const user = req.user;

    if (!amount || amount <= 0) {
      return res.status(400).json({ status: false, message: "Invalid amount entered." });
    }

    const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: user.email,
        amount: amount * 100,
        metadata: { userId: user._id, type: "deposit" },
        callback_url: `${process.env.BASE_URL}/deposit/verify`,
      }),
    });

    const data = await paystackRes.json();
    if (!data.status || !data.data) throw new Error("Failed to initialize payment with Paystack.");

    await Payment.create({
      user: user._id,
      email: user.email,
      amount: amount * 100,
      reference: data.data.reference,
      status: "pending",
    });

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

      // ✅ CREATE TRANSACTION WITH STATUS, METHOD & REFERENCE
      await Transaction.create({
        user: payment.user._id,
        type: "deposit",
        amount: depositAmount,
        description: `Deposit (Ref: ${reference})`,
        reference: reference,
        method: "Paystack",
        status: "successful",
      });

      console.log(`✅ Deposit recorded: ₦${depositAmount} for ${payment.user.email}`);
      return res.redirect("/club-de-star-cooperative/dashboard?deposit=success");

    } else {
      // ❌ Payment failed → store failed transaction
      await Transaction.create({
        user: payment.user._id,
        type: "deposit",
        amount: payment.amount / 100,
        description: `Deposit Failed (Ref: ${reference})`,
        reference: reference,
        method: "Paystack",
        status: "failed",
      });

      return res.redirect("/club-de-star-cooperative/dashboard?deposit=failed");
    }

  } catch (err) {
    console.error("Deposit verification error:", err);
    res.redirect("/club-de-star-cooperative/dashboard?deposit=failed");
  }
});

router.post("/deposit/cooperative", async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.redirect("/login");
    }

    const user = req.user;
    const { coopAmount, source, payeeName } = req.body;

    const amount = Number(coopAmount);

    // 🚨 STRONG VALIDATION
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.redirect("/club-de-star-cooperative/dashboard?deposit=invalid");
    }

    if (source === "no" && !payeeName?.trim()) {
      return res.redirect("/club-de-star-cooperative/dashboard?deposit=missing-payee");
    }

    const reference = `COOP-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    await Payment.create({
      user: user._id,
      email: user.email,
      amount, // ✅ guaranteed number
      reference,
      payeeName: source === "no" ? payeeName.trim() : null,
      status: "pending",
    });

    await Transaction.create({
      user: user._id,
      type: "deposit",
      amount,
      description: "Cooperative Deposit (Pending Approval)",
      reference,
      method: "Cooperative",
      status: "pending",
    });

    console.log(`🕒 Cooperative deposit pending: ₦${amount} — ${user.email}`);

    return res.redirect("/club-de-star-cooperative/dashboard?deposit=pending");

  } catch (err) {
    console.error("Cooperative deposit error:", err);
    return res.redirect("/club-de-star-cooperative/dashboard?deposit=failed");
  }
});



router.post("/loan/payment", async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ status: false, message: "You must be logged in to make a deposit." });
    }

    const { amount, loanId } = req.body;
    const user = req.user;

    if (!amount || amount <= 0) {
      return res.status(400).json({ status: false, message: "Invalid amount entered." });
    }

    if (!loanId) {
      return res.status(400).json({ status: false, message: "Loan ID is required." });
    }

    const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: user.email,
        amount: amount * 100,
        metadata: { userId: user._id, loanId, type: "loan repayment" },
        callback_url: `${process.env.BASE_URL}/loan/verify`,
      }),
    });

    const data = await paystackRes.json();
    if (!data.status || !data.data) throw new Error("Failed to initialize payment with Paystack.");

    await Payment.create({
      user: user._id,
      email: user.email,
      loanId, // <-- save loanId here
      amount: amount * 100,
      reference: data.data.reference,
      status: "pending",
    });

    res.json({ status: true, authorization_url: data.data.authorization_url });
  } catch (err) {
    console.error("Loan payment initialization error:", err);
    res.status(500).json({ status: false, message: "Error initializing loan payment." });
  }
});


router.get("/loan/verify", async (req, res) => {
  const { reference } = req.query;

  if (!reference) return res.redirect("/club-de-star-cooperative/dashboard?loan=failed");

  try {
    // --- 1. Verify payment with Paystack ---
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    });

    const data = await verifyRes.json();
    if (!data.status || !data.data) {
      console.error("Invalid Paystack response:", data);
      return res.redirect("/club-de-star-cooperative/dashboard?loan=failed");
    }

    const transaction = data.data;

    // --- 2. Find payment record ---
    const payment = await Payment.findOne({ reference }).populate("user");
    if (!payment) return res.redirect("/club-de-star-cooperative/dashboard?loan=not-found");

    // --- 3. Update payment status ---
    payment.status = transaction.status === "success" ? "paid" : "failed";
    payment.paystackResponse = transaction;
    await payment.save();

    // --- 4. Process successful payment ---
    if (payment.status === "paid") {

      // Fetch loan
      const loan = await Loan.findOne({ _id: payment.loanId, user: payment.user._id });
      if (!loan) {
        console.warn(`No loan found for ${payment.user.email} associated with reference ${reference}`);
        return res.redirect("/club-de-star-cooperative/dashboard?loan=not-found");
      }

      // Amount user paid now (convert from kobo)
      const paidAmount = payment.amount / 100;

      // Deduct payment from remaining balance
      loan.totalRepay = Math.max(loan.totalRepay - paidAmount, 0);

      // If loan is fully paid
      if (loan.totalRepay === 0) {
        // Mark as fully paid before deletion
        loan.status = "paid";
        await loan.save();

        // Record final payment transaction
        await Transaction.create({
          user: payment.user._id,
          type: "loan_payment",
          amount: paidAmount,
          description: `Loan fully settled (Ref: ${reference})`,
          reference: reference,
          method: "Paystack",
          status: "successful",
        });

        // Create a final "LOAN CLEARED" log
        await Transaction.create({
          user: payment.user._id,
          type: "loan_closed",
          amount: 0,
          description: `Loan account closed after full repayment`,
          method: "system",
          status: "successful",
        });

        // DELETE THE LOAN RECORD
        await Loan.deleteOne({ _id: loan._id });

        console.log(`🎉 Loan fully cleared & deleted for ${payment.user.email}`);

        return res.redirect("/club-de-star-cooperative/dashboard?loan=cleared");
      }

      // --- If PARTIAL payment ---
      await loan.save();

      await Transaction.create({
        user: payment.user._id,
        type: "loan_payment",
        amount: paidAmount,
        description: `Loan repayment (Ref: ${reference})`,
        reference: reference,
        method: "Paystack",
        status: "successful",
      });

      console.log(`✅ Loan payment recorded: ₦${paidAmount} for ${payment.user.email}`);
      return res.redirect("/club-de-star-cooperative/dashboard?loan=success");
    }

    // --- Payment failed ---
    await Transaction.create({
      user: payment.user._id,
      type: "loan_payment",
      amount: payment.amount / 100,
      description: `Loan payment failed (Ref: ${reference})`,
      reference: reference,
      method: "Paystack",
      status: "failed",
    });

    return res.redirect("/club-de-star-cooperative/dashboard?loan=failed");

  } catch (err) {
    console.error("Loan verification error:", err);
    return res.redirect("/club-de-star-cooperative/dashboard?loan=failed");
  }
});


module.exports = router;
