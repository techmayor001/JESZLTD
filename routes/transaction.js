const express = require("express");
const router = express.Router();
const Payment = require("../models/Payment");
const Account = require("../models/Account");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Loan = require("../models/Loan");
const CompanyLedger = require("../models/CompanyLedger");
const ExtraCharge = require("../models/ExtraCharge");


router.post("/deposit/init", async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ status: false, message: "You must be logged in to make a deposit." });
    }

    const { amount } = req.body;
    const user = req.user;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ status: false, message: "Invalid amount entered." });
    }

    const depositAmount = Number(amount); // what user wants to save

    // ── Calculate Paystack fee ────────────────────────────────────────────
    // Paystack: 1.5% + ₦100 flat, capped at ₦2,000, waived below ₦2,500
    let fee = Math.round(depositAmount * 0.015) + 100;
    if (depositAmount < 2500) fee = Math.round(depositAmount * 0.015);
    if (fee > 2000) fee = 2000;

    const chargeAmount = depositAmount + fee; // total user pays

    const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: user.email,
        amount: chargeAmount * 100, // Paystack needs kobo
        metadata: { userId: user._id, type: "deposit", depositAmount, fee },
        callback_url: `${process.env.BASE_URL}/deposit/verify`,
      }),
    });

    const data = await paystackRes.json();
    if (!data.status || !data.data) throw new Error("Failed to initialize payment with Paystack.");

    await Payment.create({
      user:        user._id,
      email:       user.email,
      amount:      depositAmount, // store naira the user intends to save
      reference:   data.data.reference,
      status:      "pending",
      paymentType: "deposit",
    });

    res.json({
      status:            true,
      authorization_url: data.data.authorization_url,
      depositAmount,
      fee,
      chargeAmount,
    });

  } catch (err) {
    console.error("Deposit initialization error:", err);
    res.status(500).json({ status: false, message: "Error initializing deposit." });
  }
});


router.get("/deposit/verify", async (req, res) => {
  const { reference } = req.query;
  if (!reference) return res.redirect("/cds-cooperative/dashboard?deposit=failed");

  try {
    const payment = await Payment.findOne({ reference }).populate("user");
    if (!payment) return res.redirect("/cds-cooperative/dashboard?deposit=not-found");

    // ── Guard: already processed ──────────────────────────────────────────
    if (payment.status === "paid") {
      return res.redirect("/cds-cooperative/dashboard?deposit=success");
    }

    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    });

    const data = await verifyRes.json();
    if (!data.status || !data.data) {
      return res.redirect("/cds-cooperative/dashboard?deposit=failed");
    }

    const transaction = data.data;

    payment.status = transaction.status === "success" ? "paid" : "failed";
    payment.paystackResponse = transaction;
    await payment.save();

    if (payment.status === "paid") {
      let account = await Account.findOne({ ownerType: "User", ownerId: payment.user._id });

      if (!account) {
        const defaultMemberType = await MemberType.findOne({ isDefault: true });
        account = await Account.create({
          ownerType:       "User",
          ownerId:         payment.user._id,
          accountType:     defaultMemberType?._id,
          balance:         0,
          accumulativeROI: 0,
        });
      }

      const depositAmount = payment.amount; // already naira — stored correctly in init

      account.balance += depositAmount;
      await account.save();

      await Transaction.create({
        user:        payment.user._id,
        type:        "deposit",
        amount:      depositAmount,
        description: `Deposit via Paystack (Ref: ${reference})`,
        reference,
        method:      "Paystack",
        status:      "successful",
      });

      return res.redirect("/cds-cooperative/dashboard?deposit=success");

    } else {
      await Transaction.create({
        user:        payment.user._id,
        type:        "deposit",
        amount:      payment.amount,
        description: `Deposit Failed (Ref: ${reference})`,
        reference,
        method:      "Paystack",
        status:      "failed",
      });

      return res.redirect("/cds-cooperative/dashboard?deposit=failed");
    }

  } catch (err) {
    console.error("Deposit verification error:", err);
    res.redirect("/cds-cooperative/dashboard?deposit=failed");
  }
});

router.post("/deposit/cooperative", async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = req.user;
    const { coopAmount, source, payeeName } = req.body;
    const amount = Number(coopAmount);

    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "Invalid deposit amount." });
    }

    if (source === "no" && !payeeName?.trim()) {
      return res.status(400).json({ success: false, message: "Payer name is required." });
    }

    const reference = `DEPOSIT-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    await Payment.create({
      user: user._id,
      email: user.email,
      amount,
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

    return res.status(200).json({ success: true, message: "Deposit submitted." });

  } catch (err) {
    console.error("Cooperative deposit error:", err);
    return res.status(500).json({ success: false, message: "Server error. Please try again." });
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

  if (!reference)
    return res.redirect("/cds-cooperative/dashboard?loan=failed");

  try {

    // ===== VERIFY PAYSTACK =====
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );

    const data = await verifyRes.json();
    if (!data.status || !data.data)
      return res.redirect("/cds-cooperative/dashboard?loan=failed");

    const payment = await Payment.findOne({ reference }).populate("user");
    if (!payment)
      return res.redirect("/cds-cooperative/dashboard?loan=not-found");

    // 🔒 Prevent double execution
    if (payment.status === "paid")
      return res.redirect("/cds-cooperative/dashboard?loan=success");

    payment.status = data.data.status === "success" ? "paid" : "failed";
    payment.paystackResponse = data.data;
    await payment.save();

    if (payment.status !== "paid")
      return res.redirect("/cds-cooperative/dashboard?loan=failed");

    // ===== FETCH LOAN =====
    const loan = await Loan.findOne({
      _id:  payment.loanId,
      user: payment.user._id,
    });

    if (!loan)
      return res.redirect("/cds-cooperative/dashboard?loan=not-found");

    const paidAmount = payment.amount / 100;

    // =========================================================
    // SPLIT paidAmount into loan portion and penalty portion
    //
    // paidAmount may contain both — e.g. user pays 642.97 to
    // clear a loan where totalRepay=618 and totalPenalty=24.97.
    //
    //   loanPortion    = Math.min(paidAmount, totalRepay)  → 618
    //   penaltyPortion = paidAmount - loanPortion          → 24.97
    //
    // For a partial payment (e.g. user pays 300):
    //   loanPortion    = 300
    //   penaltyPortion = 0   (penalty only recorded on full clearance)
    // =========================================================

    const loanPortion    = Math.min(paidAmount, loan.totalRepay);
    const penaltyPortion = parseFloat((paidAmount - loanPortion).toFixed(2));

    // Reduce balances
    loan.totalRepay         = parseFloat((loan.totalRepay - loanPortion).toFixed(2));
    loan.outstandingBalance = Math.max(parseFloat(((loan.outstandingBalance || 0) - paidAmount).toFixed(2)), 0);

    // =========================================================
    // COMPANY LEDGER — loan portion only (base repayment)
    // =========================================================

    const existingLedger = await CompanyLedger.findOne({
      "meta.reference": reference,
      type:             "loan_repayment",
    });

    if (!existingLedger) {
      await CompanyLedger.create({
        type:        "loan_repayment",
        amount:      loanPortion,        // e.g. 618 — never includes penalty
        direction:   "in",
        relatedUser: payment.user._id,
        relatedLoan: loan._id,
        description: "Loan repayment via Paystack",
        meta:        { reference }
      });
    }

    await Transaction.create({
      user:        payment.user._id,
      type:        "loan_payment",
      amount:      loanPortion,
      reference,
      method:      "Paystack",
      status:      "successful",
      description: "Loan repayment"
    });

    // =========================================================
    // FULLY CLEARED → record penalty portion separately
    //
    // penaltyPortion comes from the split above (paidAmount - loanPortion).
    // As a safety fallback we also cross-check against loan.totalPenalty.
    //
    // Company ledger for this loan (using your example data):
    //   loan_repayment  →  618      ✅
    //   penalty_income  →   24.97   ✅
    //                     ──────
    //   Total           →  642.97   ✅  matches paidAmount exactly
    // =========================================================

    if (loan.totalRepay === 0) {

      // Use the split amount; fall back to cron-tracked totalPenalty if needed
      const penaltyProfit = penaltyPortion > 0
        ? penaltyPortion
        : (loan.totalPenalty || (loan.penaltyHistory || []).reduce((sum, p) => sum + (p.penaltyAmount || 0), 0));

      if (penaltyProfit > 0) {

        const extraCharge = await ExtraCharge.create({
          member:      payment.user._id,
          chargeType:  "loan-penalty",
          amount:      penaltyProfit,
          relatedLoan: loan._id,
          reason:      "Overdue penalty settlement",
          status:      "paid",
          paidAt:      new Date(),
        });

        await CompanyLedger.create({
          type:        "penalty_income",
          amount:      penaltyProfit,
          direction:   "in",
          relatedLoan: loan._id,
          relatedUser: payment.user._id,
          description: "Penalty income from cleared loan",
          meta:        { extraChargeId: extraCharge._id }
        });
      }

      loan.status    = "paid";
      loan.paidAt    = new Date();
      loan.updatedAt = new Date();
      await loan.save();

      await Transaction.create({
        user:        payment.user._id,
        type:        "loan_payment",
        amount:      0,
        description: "Loan fully cleared",
        method:      "system",
        status:      "successful",
      });

      return res.redirect("/cds-cooperative/dashboard?loan=cleared");
    }

    // ===== PARTIAL PAYMENT =====
    await loan.save();
    return res.redirect("/cds-cooperative/dashboard?loan=success");

  } catch (err) {
    console.error("Loan verification error:", err);
    return res.redirect("/cds-cooperative/dashboard?loan=failed");
  }
});


router.post("/loan/payment/manual", async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = req.user;
    const { loanId, amount, payerName } = req.body;

    // ── Validation ───────────────────────────────────────────────────────────
    if (!loanId) {
      return res.status(400).json({ message: "Loan is required" });
    }

    const paymentAmount = Math.round(Number(amount));
    if (!paymentAmount || isNaN(paymentAmount) || paymentAmount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    if (payerName && !payerName.trim()) {
      return res.status(400).json({ message: "Invalid payer name" });
    }

    // ── Loan lookup ──────────────────────────────────────────────────────────
    // Try member loan first (original behaviour)

    let loan = await Loan.findOne({
      _id: loanId,
      user: user._id,
      status: { $in: ["approved", "overdue"] }
    });

    let isExternal = false;

    if (!loan) {
      // External loans have no 'user' field; they can be approved OR overdue.
      // Populate initiatedBy so we can use the admin's _id and email to
      // satisfy the Payment schema's required user/email fields.
      loan = await Loan.findOne({
        _id:      loanId,
        external: { $exists: true },
        status:   { $in: ["approved", "overdue"] }
      }).populate({ path: "initiatedBy", model: "User", select: "_id email firstName lastName" });
      if (loan) isExternal = true;
    }

    if (!loan) {
      return res.status(404).json({ message: "Loan not found or inactive" });
    }

    // ── Reference ────────────────────────────────────────────────────────────
    const reference = `LOAN-MANUAL-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    // ── Payment record ───────────────────────────────────────────────────────
    // Both branches store 'loanId' (for the approval route's isLoanPayment check)
    // as well as 'loan' (so the approval route can populate the full loan doc).
    if (isExternal) {
      // Use the admin who initiated the loan to satisfy user/email required fields.
      // This keeps the Payment schema unchanged and ties the record to the
      // correct admin for the approval flow.
      const initiator = loan.initiatedBy;
      if (!initiator) {
        return res.status(400).json({ message: "Loan has no initiating admin — cannot record payment." });
      }

      await Payment.create({
        user:      initiator._id,            // admin who issued the loan
        email:     initiator.email,          // their email satisfies required field
        loan:      loan._id,
        loanId:    loan._id,
        amount:    paymentAmount,
        reference,
        payeeName: payerName?.trim() || loan.external.borrowerName,
        paidBy:    user._id,                 // admin currently recording the payment
        status:    "pending"
      });

      await Transaction.create({
        user:        initiator._id,
        type:        "loan_payment",
        amount:      paymentAmount,
        description: `External loan repayment – ${loan.external.borrowerName} (Pending approval)`,
        reference,
        method:      "Manual",
        status:      "pending"
      });

      console.log(
        `🕒 External loan repayment pending → ₦${paymentAmount} | Loan ${loan._id} | ${loan.external.borrowerName} | Recorded by: ${user.email}`
      );
    } else {
      // Member loan — original behaviour, unchanged
      await Payment.create({
        user:      user._id,
        email:     user.email,
        loan:      loan._id,
        loanId:    loan._id,
        amount:    paymentAmount,
        reference,
        payeeName: payerName?.trim() || null,
        status:    "pending"
      });

      await Transaction.create({
        user:        user._id,
        type:        "loan_payment",
        amount:      paymentAmount,
        description: "Manual loan repayment (Pending approval)",
        reference,
        method:      "Manual",
        status:      "pending"
      });

      console.log(
        `🕒 Manual loan repayment pending → ₦${paymentAmount} | Loan ${loan._id} | ${user.email}`
      );
    }

    return res.status(200).json({
      status:  true,
      message: "Loan repayment submitted for admin approval"
    });

  } catch (err) {
    console.error("Manual loan repayment error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
