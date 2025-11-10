const express = require("express"); 
const router = express.Router();
const User = require("../models/User");
const Payment = require("../models/Payment");
const Loan = require("../models/Loan");
const Account = require("../models/Account");
const Transaction = require("../models/Transaction");




router.get('/', (req,res)=>{
    res.render("index")
})

router.get('/gallery', (req,res)=>{
    res.render("gallery")
})

router.get('/about-us', (req,res)=>{
    res.render("about")
})

router.get('/onboard/club-de-star-cooperative', (req,res)=>{
    res.render("auth")
})

// router.get('/club-de-star-cooperative/dashboard', (req,res)=>{
//     res.render("dashboard/user-dashboard")
// })


router.get("/club-de-star-cooperative/dashboard", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/login");
  }

  try {
    const user = await User.findById(req.user._id)
      .populate("Payment")
      .populate("loans")
      .populate("account")
      .exec();

    if (!user) return res.redirect("/login");

    res.render("dashboard/user-dashboard", { user });
  } catch (err) {
    console.error("Dashboard fetch error:", err);
    res.redirect("/login");
  }
});

router.get("/club-de-star-cooperative/transaction", async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.redirect("/login");
    }

    const user = req.user;

    // Fetch user transactions, most recent first
    const transactions = await Transaction.find({ user: user._id }).sort({ createdAt: -1 });

    // Fetch user account (to show balance, etc.)
    const account = await Account.findOne({ user: user._id });

    res.render("dashboard/transaction", {
      user,
      account,
      transactions,
    });
  } catch (err) {
    console.error("Transaction fetch error:", err);
    res.status(500).send("Error fetching transactions.");
  }
});








module.exports = router;