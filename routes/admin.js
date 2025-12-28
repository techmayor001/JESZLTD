const express = require("express");
const router = express.Router();

const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcrypt");
const saltRounds = 10;

const Admin = require("../models/Admin");
const User = require("../models/User");
const Settings = require("../models/Settings");
const MemberType = require("../models/MemberType");
const Account = require("../models/Account");
const Payment = require("../models/Payment");
const Transaction = require("../models/Transaction");
const LoanSettings = require("../models/LoanSettings");
const Loan = require("../models/Loan");
const LoanLedger = require('../models/LoanLedger');
const CompanyROI = require("../models/companyRoiSchema")

function ensureAdmin(req, res, next) {
  if (req.isAuthenticated() && ["admin", "staff", "superadmin"].includes(req.user.role)) {
    return next();
  }
  return res.status(403).send("Access denied. Admins only.");
}


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

  return res.redirect("/admin-login");

  } catch (err) {
    console.error("Admin signup error:", err);
    res.status(500).json({ status: false, message: "Internal Server Error" });
  }
});



router.post("/promote-to-superadmin", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ status: false, message: "Email is required." });
    }

    // Check if a super_admin already exists
    const existingSuperAdmin = await User.findOne({ roles: "super_admin" });
    if (existingSuperAdmin) {
      // Redirect to admin login if super_admin exists
      return res.redirect("/admin-login");
    }

    // Find the user to promote
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ status: false, message: "User not found." });
    }

    // Promote user to super_admin if not already
    if (!user.roles.includes("super_admin")) {
      user.roles.push("super_admin");
      await user.save();
    }

    return res.status(200).json({
      status: true,
      message: `${user.firstName} ${user.lastName} has been promoted to Super Admin.`,
      userId: user._id,
    });

  } catch (err) {
    console.error("Super Admin promotion error:", err);
    return res.status(500).json({ status: false, message: "Server error." });
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


// ADMIN PAYMENT ROUTES 
// PAYMENT MANAGEMENT
router.get("/admin/manage-payment", ensureAdmin, async (req, res) => {
  try {
    const payments = await Payment.find()
      .populate({
        path: "user",
        select: "firstName lastName membershipID email phone account",
        populate: {
          path: "account",
          select: "accountType",
          populate: {
            path: "accountType",
            model: "MemberType",
            select: "name"
          }
        }
      })
      .populate({
        path: "loanId",
        populate: {
          path: "duration",
          model: "LoanSettings"
        }
      })
      .sort({ createdAt: -1 });

    res.render("dashboard/admin/payment", {
      admin: req.user,
      payments
    });

  } catch (error) {
    console.error("Error fetching payments:", error);
    res.status(500).send("Internal Server Error");
  }
});

router.get("/admin/search-member", ensureAdmin, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);

    const users = await User.find({
      $or: [
        { membershipID: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
        { firstName: { $regex: q, $options: "i" } },
        { lastName: { $regex: q, $options: "i" } }
      ]
    })
      .populate("account")
      .limit(5);

    const results = users.map(u => ({
      id: u._id,
      name: `${u.firstName} ${u.lastName}`,
      membershipID: u.membershipID,
      email: u.email,
      balance: u.account?.balance || 0
    }));

    res.json(results);

  } catch (err) {
    console.error("Search member error:", err);
    res.status(500).json([]);
  }
});




// ADMINS CONFIG 

// MEMBER TYPE 
router.get("/admin/manage/memberType", ensureAdmin, async (req, res) => {
  try {
    const memberTypes = await MemberType.find().sort({ name: 1 }).lean();

    // Count members for each type
    const users = await User.find({}, "account membershipID").lean();

    memberTypes.forEach(type => {
      type.members = users.filter(u => u.membershipID?.startsWith(type.shortCode)).length;
    });

    res.render("dashboard/admin/member-type", {
      admin: req.user,
      memberTypes
    });
  } catch (error) {
    console.error("Error fetching member types:", error);
    res.status(500).send("Internal Server Error");
  }
});

// CREATE or UPDATE Member Type
router.post("/admin/manage/memberType", ensureAdmin, async (req, res) => {
  try {
    const { id, name, shortCode, interestRate, isDefault } = req.body;

    if (!shortCode || shortCode.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Shortcode is required",
      });
    }

    // If this member type is being set as default → unset previous default(s)
    if (isDefault) {
      await MemberType.updateMany(
        { isDefault: true },
        { isDefault: false }
      );
    }

    // UPDATE existing MemberType
    if (id) {
      const existingType = await MemberType.findById(id);
      if (!existingType) {
        return res.json({
          success: false,
          message: "Membership type not found",
        });
      }

      const oldShortCode = existingType.shortCode?.trim() || "";
      const newShortCode = shortCode.trim();

      // Update the MemberType document
      const updated = await MemberType.findByIdAndUpdate(
        id,
        { name, shortCode: newShortCode, interestRate, isDefault },
        { new: true }
      );

      // 🔥 If shortcode first letter changed → update all users
      if (oldShortCode.charAt(0) !== newShortCode.charAt(0)) {
        const newChar = newShortCode.charAt(0);
        const users = await User.find({});

        let updatedCount = 0;

        for (const user of users) {
          if (!user.membershipID) continue;

          // Replace only the first character
          const newMembershipID = newChar + user.membershipID.substring(1);

          if (user.membershipID !== newMembershipID) {
            user.membershipID = newMembershipID;
            user.referralCode = newMembershipID;
            await user.save();
            updatedCount++;
          }
        }

        console.log(`Users updated: ${updatedCount}`);
      }

      return res.json({
        success: true,
        message: "Membership type updated successfully",
        updated,
      });
    }

    // CREATE new MemberType
    const newType = new MemberType({
      name,
      shortCode: shortCode.trim(),
      interestRate,
      isDefault,
    });

    // If it is set as default, ensure others are unset (already done above)
    await newType.save();

    return res.json({
      success: true,
      message: "Membership type created successfully",
      newType,
    });
  } catch (error) {
    console.error("Error saving member type:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});



// DELETE Member Type
router.delete("/admin/manage/memberType/:id", ensureAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await MemberType.findByIdAndDelete(id);

    if (!deleted) {
      return res.json({ success: false, message: "Membership type not found" });
    }

    return res.json({ success: true, message: "Membership type deleted" });

  } catch (error) {
    console.error("Error deleting member type:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});


// GET: Manage Members Page
router.get('/admin/manage/members', ensureAdmin, async (req, res) => {
    try {
        // Fetch all users + their accounts + membership type inside account
        const users = await User.find()
            .populate({
                path: "account",
                populate: {
                    path: "accountType", // MemberType reference
                }
            });

        // Fetch all membership types
        const memberTypes = await MemberType.find();

        res.render('dashboard/admin/members', {
            admin: req.user,
            users,
            memberTypes
        });

    } catch (err) {
        console.error("Error loading members:", err);
        res.status(500).send("Server error loading members");
    }
});

router.post('/admin/members/approve/:id', ensureAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        const { memberTypeId } = req.body;

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        const type = await MemberType.findById(memberTypeId);
        if (!type) return res.status(404).json({ message: "Member type not found" });

        // Find the last membership ID for this type
        const lastUser = await User.findOne({ membershipID: { $regex: `^${type.shortCode}` } })
                                   .sort({ membershipID: -1 })
                                   .lean();

        let nextNumber = 1;

        if (lastUser && lastUser.membershipID) {
            const lastNumberStr = lastUser.membershipID.replace(type.shortCode, '');
            const lastNumber = parseInt(lastNumberStr, 10);
            if (!isNaN(lastNumber)) {
                nextNumber = lastNumber + 1;
            }
        }

        // Generate sequential Membership ID
        const membershipID = `${type.shortCode}${String(nextNumber).padStart(3, '0')}`;

        // Update user
        user.status = "active";
        user.membershipID = membershipID;
        await user.save();

        // Update or create account
        let account = await Account.findOne({ user: user._id });
        if (!account) {
            account = new Account({
                user: user._id,
                accountType: type._id
            });
        } else {
            account.accountType = type._id;
        }
        await account.save();

        // Return to frontend
        res.json({
            message: "Member approved successfully",
            membershipID,
            memberTypeName: type.name,
            email: user.email
        });

    } catch (err) {
        console.error("Approve member error:", err);
        res.status(500).json({ message: "Internal server error" });
    }
});

router.post('/admin/members/delete/:id', ensureAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    // Find user
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ status: false, message: 'User not found' });

    // Delete related account
    if (user.account) {
      await Account.findByIdAndDelete(user.account);
    }

    // Delete related payment records
    if (user.Payment) {
      await Payment.findByIdAndDelete(user.Payment);
    }

    // Optionally, remove references from other users' referrals
    await User.updateMany(
      { referredUsers: user._id },
      { $pull: { referredUsers: user._id } }
    );

    // Delete the user
    await User.findByIdAndDelete(userId);

    res.json({ status: true, message: 'Member deleted successfully' });
  } catch (err) {
    console.error('Delete member error:', err);
    res.status(500).json({ status: false, message: 'Internal server error' });
  }
});

// Delete member and all associated data
router.post("/members/delete/:id", async (req, res) => {
    try {
        const memberId = req.params.id;

        const user = await User.findById(memberId);
        if (!user) {
            return res.status(404).json({ status: false, message: "Member not found" });
        }

        // Delete Account
        if (user.account) {
            await Account.findByIdAndDelete(user.account);
        }

        // Delete Loans
        if (user.loans && user.loans.length > 0) {
            await Loan.deleteMany({ _id: { $in: user.loans } });
        }

        // Delete Payments
        if (user.Payment) {
            await Payment.findByIdAndDelete(user.Payment);
        }

        // Delete Transactions
        await Transaction.deleteMany({ user: memberId });

        // Remove member from referredUsers of other users
        await User.updateMany(
            { referredUsers: memberId },
            { $pull: { referredUsers: memberId } }
        );

        // Delete Guarantor Requests associated with this user
        await User.updateMany(
            { "guarantorRequests.borrower": memberId },
            { $pull: { guarantorRequests: { borrower: memberId } } }
        );

        // Finally, delete the user
        await User.findByIdAndDelete(memberId);

        res.json({ status: true, message: "Member and all associated data deleted successfully" });
    } catch (err) {
        console.error("Error deleting member:", err);
        res.status(500).json({ status: false, message: "Error deleting member" });
    }
});



// LOAN MANAGEMENT 
router.get("/admin/manage-loan", ensureAdmin, async (req, res) => {
  try {
    const loans = await Loan.find()
      .populate({
        path: "user",
        select: "firstName lastName membershipID email phone account", // <-- added email and phone
        populate: {
          path: "account",
          select: "accountType",
          populate: {
            path: "accountType",
            model: "MemberType",
            select: "name"
          }
        }
      })
      .populate("duration") // LoanSettings
      .populate({
        path: "guarantors.guarantor",
        select: "firstName lastName membershipID email phone account" // <-- added email and phone for guarantors
      })
      .sort({ createdAt: -1 });

    res.render("dashboard/admin/loan", { admin: req.user, loans });

  } catch (error) {
    console.error("Error fetching loans:", error);
    res.status(500).send("Internal Server Error");
  }
});

router.post("/api/loans/approve", ensureAdmin, async (req, res) => {
  try {
    const { loanId, disbursementMethod, disbursementDate } = req.body;
    if (!loanId || !disbursementMethod || !disbursementDate) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    const approvedBy = req.user?._id;
    if (!approvedBy) return res.status(401).json({ message: "Unauthorized." });

    const loan = await Loan.findById(loanId)
      .populate("duration")
      .populate("user")
      .populate("guarantors.guarantor");

    if (!loan) return res.status(404).json({ message: "Loan not found." });

    const allGuarantorsAccepted = loan.guarantors.every(g => g.status === "accepted");
    if (!allGuarantorsAccepted) {
      return res.status(400).json({ message: "All guarantors must accept." });
    }

    const durationMonths = loan.duration?.duration;
    if (!durationMonths) return res.status(400).json({ message: "Loan duration missing." });

    // --- DELETE EXISTING LOAN FOR USER BEFORE APPROVING NEW ONE ---
    const existingLoan = await Loan.findOne({
      user: loan.user._id,
      _id: { $ne: loan._id }, // exclude current loan
      status: { $in: ["pending", "approved"] }
    });

    if (existingLoan) {
      await Loan.deleteOne({ _id: existingLoan._id });
      console.log(`Deleted existing loan ${existingLoan._id} for user ${loan.user._id}`);
    }

    // --- APPROVE LOAN ---
    const disburseDate = new Date(disbursementDate);
    const dueDate = new Date(disburseDate);
    dueDate.setMonth(dueDate.getMonth() + durationMonths);

    loan.status = "approved";
    loan.disbursementMethod = disbursementMethod;
    loan.disbursementDate = disburseDate;
    loan.dueDate = dueDate;
    loan.approvedAt = new Date();
    await loan.save();

    const ledgerEntry = await LoanLedger.create({
      loan: loan._id,
      member: loan.user._id,
      approvedBy,
      amount: loan.amount,
      interestRate: loan.interestRate,
      durationMonths,
      disbursementMethod,
      disbursementDate: disburseDate,
      dueDate,
      approvedAt: new Date(),
      status: "approved"
    });

    // Update guarantor stats
    for (const g of loan.guarantors) {
      const user = await User.findById(g.guarantor._id);
      user.guarantorRequestStats.totalReceived += 1;
      if (g.status === "accepted") {
        user.guarantorRequestStats.totalAccepted += 1;
        user.guarantorRequestStats.totalAmountApproved += loan.amount;
      } else {
        user.guarantorRequestStats.totalDeclined += 1;
      }
      await user.save();
    }

    // --- Company ROI logic ---
    const currentMonth = new Date().toISOString().slice(0, 7); // e.g., "2025-12"
    let companyRoi = await CompanyROI.findOne({ month: currentMonth });
    const interestForThisLoan = loan.amount * (loan.interestRate / 100);

    if (!companyRoi) {
      companyRoi = await CompanyROI.create({
        month: currentMonth,
        totalInterestCollected: interestForThisLoan,
        companyCharge: interestForThisLoan * 0.1,
        netInterestForRoi: interestForThisLoan * 0.9,
        totalRoiDistributed: 0,
        status: "open"
      });
    } else if (companyRoi.status === "open") {
      companyRoi.totalInterestCollected += interestForThisLoan;
      companyRoi.companyCharge = companyRoi.totalInterestCollected * 0.1;
      companyRoi.netInterestForRoi = companyRoi.totalInterestCollected - companyRoi.companyCharge;
      await companyRoi.save();
    }

    return res.status(200).json({
      message: `Loan for ${loan.user.firstName} ${loan.user.lastName} approved successfully.`,
      loan,
      ledger: ledgerEntry,
      companyRoi
    });

  } catch (error) {
    console.error("Error approving loan:", error);
    return res.status(500).json({ message: "Server error while approving loan." });
  }
});


router.get("/admin/loan/settings", ensureAdmin, async (req, res) => {
  try {
    const loanSettings = await LoanSettings.find().sort({ loanName: 1 });

    res.render("dashboard/admin/loan-settings", {
      admin: req.user,
      loanSettings
    });

  } catch (error) {
    console.error("Error fetching loan settings:", error);
    res.status(500).send("Internal Server Error");
  }
});

router.post("/api/loan/settings/add", ensureAdmin, async (req, res) => {
  try {
    const {
      id, // This will be used for editing
      loanName,
      duration,
      penaltyPercentage,
      rolloverPercentage,
      eligibilityUnit,
      eligibilityValue,
      status
    } = req.body;

    // If ID exists → UPDATE
    if (id) {
      const updated = await LoanSettings.findByIdAndUpdate(
        id,
        {
          loanName,
          duration,
          penaltyPercentage,
          rolloverPercentage,
          eligibilityUnit,
          eligibilityValue,
          status: status === "active" ? "active" : "inactive",
          updatedAt: Date.now()
        },
        { new: true }
      );

      if (!updated) {
        return res.json({ status: false, message: "Loan setting not found" });
      }

      return res.json({ status: true, message: "Loan setting updated successfully", updated });
    }

    // If NO ID → CREATE NEW
    const newSetting = new LoanSettings({
      loanName,
      duration,
      penaltyPercentage,
      rolloverPercentage,
      eligibilityUnit,
      eligibilityValue,
      status: status === "active" ? "active" : "inactive",
      updatedAt: Date.now()
    });

    await newSetting.save();

    return res.json({ status: true, message: "Loan setting added successfully", newSetting });

  } catch (error) {
    console.error("Error saving loan setting:", error);
    return res.json({ status: false, message: "Failed to save loan setting" });
  }
});

router.post("/api/loan/settings/toggle", ensureAdmin, async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) return res.json({ status: false, message: "Missing setting ID" });

    const setting = await LoanSettings.findById(id);
    if (!setting) return res.json({ status: false, message: "Setting not found" });

    // Toggle status
    setting.status = setting.status === "active" ? "inactive" : "active";
    setting.updatedAt = Date.now();

    await setting.save();

    return res.json({
      status: true,
      message: `Setting ${setting.status === "active" ? "activated" : "deactivated"} successfully`,
      newStatus: setting.status
    });

  } catch (error) {
    console.error("Toggle setting error:", error);
    return res.json({ status: false, message: "Failed to toggle setting" });
  }
});

router.post("/api/loan/settings/delete", ensureAdmin, async (req, res) => {
    try {
        const { id } = req.body;

        if (!id) return res.status(400).send("Invalid setting ID");

        // Delete the setting
        await LoanSettings.findByIdAndDelete(id);

        // Redirect back to the loan settings page
        res.redirect("/admin/loan/settings");

    } catch (error) {
        console.error("Error deleting loan setting:", error);
        res.status(500).send("Failed to delete loan setting");
    }
});



// SETTINGS ROUTE 
router.get("/admin/settings", ensureAdmin, async (req, res) => {
  try {
    const settings = await Settings.getSettings();

    res.render("dashboard/admin/settings", {
      admin: req.user,
      settings
    });
  } catch (error) {
    console.error("Error fetching settings:", error);
    res.status(500).send("Internal Server Error");
  }
});


// Update ONLY interest rates
router.post("/admin/settings/interest-rates", ensureAdmin, async (req, res) => {
  console.log(req.body)
  try {
    const { clubRate, nonClubRate } = req.body;

    const settings = await Settings.getSettings();

    settings.interestRates.clubMemberRate = clubRate;
    settings.interestRates.nonClubMemberRate = nonClubRate;

    await settings.save();

    res.json({ success: true, message: "Interest rates updated!" });

  } catch (err) {
    console.error("Error updating interest:", err);
    res.status(500).json({ success: false, message: "Failed to update interest" });
  }
});

// Update Registration Fees
router.post("/admin/settings/registration-fees", ensureAdmin, async (req, res) => {
  try {
    const { adultFee, kiddiesFee } = req.body;

    const settings = await Settings.getSettings();

    settings.registrationFees.adultRegistrationFee = adultFee;
    settings.registrationFees.kiddiesRegistrationFee = kiddiesFee;

    await settings.save();

    res.json({ success: true, message: "Registration fees updated successfully!" });

  } catch (err) {
    console.error("Error updating registration fees:", err);
    res.status(500).json({ success: false, message: "Failed to update registration fees" });
  }
});

// Update Kiddies Account Settings
router.post("/admin/settings/kiddies-settings", ensureAdmin, async (req, res) => {
  try {
    const {
      minAge,
      maxAge,
      upgradeAge,
      monthlyFee,
      upgradeFee,
      interestRate,
      notificationDays
    } = req.body;

    const settings = await Settings.getSettings();

    settings.kiddiesSettings.minAge = minAge;
    settings.kiddiesSettings.maxAge = maxAge;
    settings.kiddiesSettings.upgradeAge = upgradeAge;
    settings.kiddiesSettings.monthlyMaintenanceFee = monthlyFee;
    settings.kiddiesSettings.upgradeProcessingFee = upgradeFee;
    settings.kiddiesSettings.kiddiesInterestRate = interestRate;

    // Enum is 30, 60, 90 – ensure valid fallback
    settings.kiddiesSettings.autoUpgradeNotificationDays =
      [30, 60, 90].includes(Number(notificationDays)) ? notificationDays : 60;

    await settings.save();

    res.json({ success: true, message: "Kiddies settings updated successfully!" });

  } catch (err) {
    console.error("Error updating kiddies settings:", err);
    res.status(500).json({ success: false, message: "Failed to update kiddies settings" });
  }
});


// Update Additional Fees & Charges
router.post("/admin/settings/other-fees", ensureAdmin, async (req, res) => {
  try {
    const { forceWithdrawal, loanProcessing, roiOperating } = req.body;

    const settings = await Settings.getSettings();

    settings.otherFees.forceWithdrawalCharge = forceWithdrawal;
    settings.otherFees.loanProcessingFee = loanProcessing; // optional if you want to store separately
    settings.otherFees.roiOperatingCharge = roiOperating;

    await settings.save();

    res.json({ success: true, message: "Additional fees updated successfully!" });

  } catch (err) {
    console.error("Error updating other fees:", err);
    res.status(500).json({ success: false, message: "Failed to update additional fees" });
  }
});

module.exports = router;
