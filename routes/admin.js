const express = require("express");
const router = express.Router();

const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcrypt");
const saltRounds = 10;

const Admin = require("../models/Admin");


// ------------------ ADMIN SIGNUP ------------------
router.get("/admin-signup", async (req, res) => {
  try {
    const superadminExists = await Admin.findOne({ role: "superadmin" });

    if (superadminExists) {
      return res.redirect("/admin-login");
    }

    res.render("auth/admin-auth");
  } catch (error) {
    console.error("Error checking superadmin:", error);
    res.status(500).send("Internal Server Error");
  }
});


// ------------------ ADMIN LOGIN PAGE ------------------
router.get("/admin-login", (req, res) => {
  res.render("auth/admin-login");
});


router.post("/admin-signup", async (req, res) => {
  try {
    const { fullName, email, password, role } = req.body;

    // Validate required fields
    if (!fullName || !email || !password || !role) {
      return res.status(400).json({ status: false, message: "All fields are required." });
    }

    // Validate role
    const validRoles = ["admin", "staff", "superadmin"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ status: false, message: "Invalid role provided." });
    }

    // Check if email already exists
    const existingAdmin = await Admin.findOne({ email: email.toLowerCase() });
    if (existingAdmin) {
      return res.status(400).json({ status: false, message: "Email already registered." });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create admin
    const newAdmin = await Admin.create({
      fullName,
      email: email.toLowerCase(),
      password: hashedPassword,
      role
    });

    res.status(201).json({
      status: true,
      message: `Admin account created successfully for role: ${role}`,
      adminId: newAdmin._id
    });

  } catch (err) {
    console.error("Admin signup error:", err);
    res.status(500).json({ status: false, message: "Internal Server Error" });
  }
});


router.post("/admin-login", (req, res, next) => {
  passport.authenticate("admin-local", (err, user, info) => {
    if (err) return res.status(500).render("auth/admin-login", { error: "An error occurred" });
    if (!user) return res.status(401).render("auth/admin-login", { error: info?.message });
    
    req.logIn(user, (err) => {
      if (err) return res.status(500).render("auth/admin-login", { error: "Login failed" });
      
      if (["admin", "superadmin"].includes(user.role)) return res.redirect("/admin-dashboard");
      return res.redirect("/onboard/club-de-star-cooperative");
    });
  })(req, res, next);
});



// ------------------ LOGOUT ------------------
router.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error("Logout error:", err);
      return res.redirect("/dashboard?error=logout_failed");
    }
    res.redirect("/admin-login");
  });
});

module.exports = router;
