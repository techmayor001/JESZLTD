const express = require("express");
const router = express.Router();
const Payment = require("../models/Payment");
const Account = require("../models/Account");
const User = require("../models/User");
const Transaction = require("../models/Transaction");

const KiddiesAccount = require("../models/Kiddies/kiddiesAccount");
const Settings = require("../models/Settings");
const MemberType = require("../models/MemberType");
const KiddiesTransaction = require("../models/Kiddies/kiddiesTransaction");





router.get("/manage/kiddies-account", async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.redirect("/login");
    }

    const loggedInUserId = req.user._id;
    const user = await User.findById(loggedInUserId);

    if (!user) return res.status(404).send("User not found");

    const kiddiesAccounts = await KiddiesAccount.find({ parent: loggedInUserId })
      .populate("account") 
      .populate("transactions"); 

    const settings = await Settings.getSettings();
    const kiddiesRegistrationFee = settings.registrationFees.kiddiesRegistrationFee;

    // --------------------------
    // 1️⃣ Fetch all MemberTypes for frontend selection
    // --------------------------
    const memberTypes = await MemberType.find({});

    return res.render("dashboard/kiddies", {
      user,
      kiddiesAccounts,
      kiddiesRegistrationFee,
      settings,
      memberTypes // ✅ pass this to EJS
    });

  } catch (err) {
    console.error("Error loading kiddies account page:", err);
    return res.status(500).send("Server error");
  }
});

// router.post("/api/kiddies/create", (req,res)=>{
//   console.log(req.body)
// })


router.post("/api/kiddies/create", async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ status: false, message: "Unauthorized" });
    }

    const parentId = req.user._id;

    const {
      childFirstName,
      childLastName,
      childDOB,
      childGender,
      initialDeposit,
      memberTypeId, // ← Selected from frontend
      beneficiaryType,
      nextOfKinFullName,
      nextOfKinPhone,
      nextOfKinEmail,
      nextOfKinRelationship,
      nextOfKinAddress,
      barNumber,
      lawFirm,
    } = req.body;

    // Validate required fields
    if (
      !childFirstName ||
      !childLastName ||
      !childDOB ||
      !childGender ||
      !initialDeposit ||
      !memberTypeId ||
      !beneficiaryType ||
      !nextOfKinFullName ||
      !nextOfKinPhone ||
      !nextOfKinEmail ||
      !nextOfKinRelationship ||
      !nextOfKinAddress
    ) {
      return res
        .status(400)
        .json({ status: false, message: "Missing required fields." });
    }

    // --------------------------
    // 0️⃣ Get MemberType
    // --------------------------
    const memberType = await MemberType.findById(memberTypeId);
    if (!memberType) {
      return res.status(400).json({ status: false, message: "Invalid account type" });
    }

    // --------------------------
    // 1️⃣ Create the Kiddies Wallet (balance 0 until payment verified)
    // --------------------------
    const kiddiesWallet = await Account.create({
      user: parentId,
      accountType: memberType._id,
      balance: 0,
      monthlyROI: memberType.interestRate || 0,
      accumulativeROI: 0,
    });

    // --------------------------
    // 2️⃣ Create Kiddies Account
    // --------------------------
    const newKiddiesAccount = await KiddiesAccount.create({
      parent: parentId,
      childFirstName,
      childLastName,
      childDOB,
      childGender,
      account: kiddiesWallet._id,
      beneficiaryType,
      nextOfKin: {
        fullName: nextOfKinFullName,
        phone: nextOfKinPhone,
        email: nextOfKinEmail,
        relationship: nextOfKinRelationship,
        address: nextOfKinAddress,
        barNumber: beneficiaryType === "lawyer" ? barNumber : undefined,
        lawFirm: beneficiaryType === "lawyer" ? lawFirm : undefined,
      },
      registrationStatus: "pending",
      status: "active",
    });

    // --------------------------
    // 3️⃣ Initialize Paystack Payment
    // --------------------------
    const paystackRes = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: req.user.email,
          amount: Number(initialDeposit) * 100, // convert to kobo
          metadata: {
            parentId,
            kiddiesAccountId: newKiddiesAccount._id,
            type: "kiddies_initial_deposit",
          },
          callback_url: `${process.env.BASE_URL}/payment/kiddies/verify`,
        }),
      }
    );

    const data = await paystackRes.json();
    if (!data.status) {
      console.log("PAYSTACK INIT ERROR → ", data);
      return res
        .status(500)
        .json({ status: false, message: "Payment initialization failed" });
    }

    // --------------------------
    // 4️⃣ Save Payment record
    // --------------------------
const payment = await Payment.create({
  user: parentId,
  email: req.user.email,   // required by schema
  amount: Number(initialDeposit),
  reference: data.data.reference,
  status: "pending",
  // optional: link to kiddies account
  relatedAccount: newKiddiesAccount._id,
});


    newKiddiesAccount.initialDepositPayment = payment._id;
    await newKiddiesAccount.save();

    // --------------------------
    // 5️⃣ Respond with Paystack URL
    // --------------------------
    res.json({
      status: true,
      message: "Kiddies account created. Redirect user to complete payment.",
      authorization_url: data.data.authorization_url,
      reference: data.data.reference,
      kiddiesAccountId: newKiddiesAccount._id,
    });

  } catch (err) {
    console.error("Kiddies Account Creation Error:", err);
    res.status(500).json({ status: false, message: "Server error" });
  }
});



router.get("/payment/kiddies/verify", async (req, res) => {
  const { reference } = req.query;

  if (!reference) return res.redirect("/manage/kiddies-account?payment=failed");

  try {
    // Verify transaction with Paystack
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
      console.error("Invalid Paystack response:", data);
      return res.redirect("/manage/kiddies-account?payment=failed");
    }

    const transaction = data.data;

    // -------------------------------
    // 1️⃣ Retrieve Payment Record
    // -------------------------------
    const payment = await Payment.findOne({ reference });

    if (!payment)
      return res.redirect("/manage/kiddies-account?error=payment-not-found");

    const isPaid = transaction.status === "success";

    // Update payment status
    payment.status = isPaid ? "success" : "failed";
    payment.paystackResponse = transaction;
    payment.verifiedAt = isPaid ? new Date() : null;
    await payment.save();

    if (!isPaid) {
      return res.redirect("/manage/kiddies-account?payment=failed");
    }

    // ---------------------------------------------
    // 2️⃣ Extract Kiddies Account from metadata
    // ---------------------------------------------
    const kiddiesAccountId = transaction.metadata.kiddiesAccountId;
    const parentId = transaction.metadata.parentId;

    const kiddyAcc = await KiddiesAccount.findById(kiddiesAccountId);
    if (!kiddyAcc) {
      console.error("Kiddies Account Not Found!");
      return res.redirect("/manage/kiddies-account?payment=failed");
    }

    // --------------------------------------------------
    // 3️⃣ CREDIT the Kiddies Wallet (initial deposit)
    // --------------------------------------------------
    const wallet = await Account.findById(kiddyAcc.account);

    wallet.balance += Number(payment.amount);
    await wallet.save();

    // --------------------------------------------------
    // 4️⃣ Create Kiddies Transaction Record (Deposit)
    // --------------------------------------------------
    const depositTxn = await KiddiesTransaction.create({
      kiddiesAccount: kiddiesAccountId,
      type: "deposit",
      amount: payment.amount,
      description: "Initial Kiddies Account Deposit",
      status: "success",
    });

    kiddyAcc.transactions.push(depositTxn._id);
    await kiddyAcc.save();

    // --------------------------------------------------
    // 5️⃣ PUSH Kiddies Account to the User
    // --------------------------------------------------
    await User.findByIdAndUpdate(parentId, {
      $addToSet: { kiddiesAccounts: kiddiesAccountId }, // ensures no duplicates
    });

    // --------------------------------------------------
    // 6️⃣ Redirect Success
    // --------------------------------------------------
    return res.redirect(
      "/manage/kiddies-account?payment=success&kid=" + kiddiesAccountId
    );

  } catch (err) {
    console.error("Payment verification error:", err);
    res.redirect("/manage/kiddies-account?payment=failed");
  }
});













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
