// middleware/globalData.js
const User = require("./models/User");

module.exports = async function (req, res, next) {
  try {
    if (!req.isAuthenticated()) {
      res.locals.pendingGuarantorCount = 0;
      return next();
    }

    // fetch only guarantorRequests field (FAST)
    const user = await User.findById(req.user._id)
      .select("guarantorRequests");

    if (!user) {
      res.locals.pendingGuarantorCount = 0;
      return next();
    }

    // count pending requests
    const pendingCount = user.guarantorRequests.filter(
      r => r.status === "pending"
    ).length;

    res.locals.pendingGuarantorCount = pendingCount;

  } catch (err) {
    console.error("Global guarantor count error:", err);
    res.locals.pendingGuarantorCount = 0;
  }

  next();
};