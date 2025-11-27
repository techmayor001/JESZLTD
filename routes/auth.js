const express = require("express");
const router = express.Router();

const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;

const bcrypt = require("bcrypt");
const saltRounds = 10;

const User = require("../models/User");
const Payment = require("../models/Payment");
const Account = require("../models/Account");

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
  limits: { fileSize: 2 * 1024 * 1024 }

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
        referralCode, // referral code from signup form
        password,
      } = req.body;

      // ✅ Check for existing email
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res
          .status(400)
          .json({ status: false, message: "This email is already registered." });
      }

      // File uploads
      const addressProof = req.files["addressProof"]?.[0]?.path;
      const passportPhoto = req.files["passportPhoto"]?.[0]?.path;
      const idFile = req.files["idFile"]?.[0]?.path;
      const signature = req.files["signature"]?.[0]?.path;

      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Generate membershipID and referral code
      const lastUser = await User.findOne({}).sort({ createdAt: -1 });
      const nextNumber = lastUser
        ? parseInt(lastUser.membershipID?.slice(-3)) + 1
        : 1;
      const membershipID = `NCD${String(nextNumber).padStart(3, "0")}`;
      const newReferralCode = membershipID;

      // Create new user
      const newUser = await User.create({
        firstName,
        lastName,
        email,
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
        referralCode: newReferralCode,
        membershipID,
        password: hashedPassword,
        status: "pending",
      });

      // Handle referral if provided
      if (referralCode) {
        const referringUser = await User.findOne({ referralCode });
        if (referringUser) {
          referringUser.referredUsers.push(newUser._id);
          await referringUser.save();
        }
      }

      // Auto-login
      req.login(newUser, (err) => {
        if (err) console.error("Auto-login error:", err);
      });

      // Create Account for the user
      const account = await Account.create({
        user: newUser._id,
        accountType: "NCD", // default NCD
        balance: 0,
        interestRate: 10,
      });

      // Link account to user
      newUser.account = account._id;
      await newUser.save();

      // Initialize Paystack transaction
      const paystackRes = await fetch(
        "https://api.paystack.co/transaction/initialize",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email,
            amount: 200000, // in kobo
            metadata: { firstName, lastName, userId: newUser._id },
            callback_url: `${process.env.BASE_URL}/payment/verify`,
          }),
        }
      );

      const data = await paystackRes.json();
      if (!data.status || !data.data)
        throw new Error("Payment initialization failed");

      const payment = await Payment.create({
        user: newUser._id,
        email,
        amount: 200000,
        reference: data.data.reference,
        status: "pending",
      });

      newUser.Payment = payment._id;
      await newUser.save();

      res.json({ status: true, authorization_url: data.data.authorization_url });
    } catch (err) {
      console.error("Signup error:", err);
      res
        .status(500)
        .json({ status: false, message: "Error during registration." });
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
    payment.status = transaction.status === "success" ? "paid" : "failed";
    payment.paystackResponse = transaction;
    await payment.save();

    // Do NOT change user.status here — approval remains admin's responsibility
    // You can optionally show a message to the user about successful payment
    if (payment.status === "paid") {
      return res.redirect("/club-de-star-cooperative/dashboard?payment=success");
    } else {
      return res.redirect("/signup?payment=failed");
    }
  } catch (err) {
    console.error("Payment verification error:", err);
    res.redirect("/signup?payment=failed");
  }
});

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
router.get("/login", (req, res) => {
  res.render("auth/login");
});


router.get("/forgot-password", (req, res) => {
  res.render("auth/recovery");
});


// LOGIN ROUTE
router.post("/login", (req, res, next) => {
  passport.authenticate("user-local", (err, user, info) => {

    if (err) {
      return res.status(500).render("auth/login", { 
        error: "An error occurred. Please try again." 
      });
    }

    if (!user) {
      if (info?.message === "No user found") {
        return res.status(401).render("auth/login", { 
          error: "Email not found. Please register first.",
          info: "Need an account? Click Register Here below."
        });
      } 
      else if (info?.message === "Incorrect password") {
        return res.status(401).render("auth/login", { 
          error: "Incorrect password. Please try again." 
        });
      } 
      else if (info?.message === "Invalid email") {
        return res.status(401).render("auth/login", { 
          error: "Please enter a valid email address." 
        });
      }
      return res.status(401).render("auth/login", { 
        error: info?.message || "Invalid credentials" 
      });
    }

    req.logIn(user, (err) => {
      if (err) {
        return res.status(500).render("auth/login", { 
          error: "Login failed. Please try again." 
        });
      }

      if (user.role === "admin") {
        return res.redirect("/admin-dashboard");
      } else {
        return res.redirect("/club-de-star-cooperative/dashboard");
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


module.exports = router;