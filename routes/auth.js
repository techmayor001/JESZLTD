const express = require("express");
const router = express.Router();

const session = require("express-session");
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;


const mongoose = require("mongoose");


const bcrypt = require("bcrypt");
const saltRounds = 10;

router.use(session({
    secret: "TOP_SECRET",
    resave: false,
    saveUninitialized: true
}));

router.use(passport.initialize());
router.use(passport.session());




const User = require("../models/User");
const Payment = require("../models/Payment");
const Account = require("../models/Account");

const multer = require('multer');
const fs = require('fs');
const path = require('path')

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

router.get("/terms", (req, res) => {
  res.render("auth/terms");
});




router.post("/login", (req, res, next) => {
  passport.authenticate("local", (err, user, info) => {

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



router.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error("Logout error:", err);
      return res.redirect("/dashboard?error=logout_failed");
    }
    res.redirect("/login");
  });
});



passport.use(
  new LocalStrategy(
    { usernameField: "email" }, // 👈 tells Passport to expect "email"
    async function verify(email, password, done) {
      try {
        // Case-insensitive search
        const foundUser = await User.findOne({ email: email.toLowerCase() });

        if (!foundUser) {
          return done(null, false, { message: "No user found with that email" });
        }

        const match = await bcrypt.compare(password, foundUser.password);
        if (!match) {
          return done(null, false, { message: "Incorrect password" });
        }

        return done(null, foundUser);
      } catch (err) {
        return done(err);
      }
    }
  )
);


passport.serializeUser((user, done) =>{
    done(null, user);
})

passport.deserializeUser(async (user, done) => {
  try {
    const fullUser = await User.findById(user._id).populate('role');
    done(null, fullUser);
  } catch (err) {
    done(err);
  }
});



module.exports = router;