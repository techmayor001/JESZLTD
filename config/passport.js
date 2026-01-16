const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcrypt");

const User = require("../models/User");
const Admin = require("../models/Admin");

/* ============================================================
   USER STRATEGY (role = member)
============================================================ */
passport.use(
  "user-local",
  new LocalStrategy(
    { usernameField: "email" },
    async (email, password, done) => {
      try {
        const user = await User.findOne({ email: email.toLowerCase() });

        if (!user)
          return done(null, false, { message: "No user found" });

        const match = await bcrypt.compare(password, user.password);

        if (!match)
          return done(null, false, { message: "Incorrect password" });

        return done(null, user);

      } catch (err) {
        return done(err);
      }
    }
  )
);

/* ============================================================
   ADMIN STRATEGY (admin, staff, superadmin)
============================================================ */
passport.use(
  "admin-local",
  new LocalStrategy(
    { usernameField: "email" },
    async (email, password, done) => {
      try {
        const admin = await Admin.findOne({ email: email.toLowerCase() });

        if (!admin)
          return done(null, false, { message: "Admin not found" });

        const match = await bcrypt.compare(password, admin.password);

        if (!match)
          return done(null, false, { message: "Incorrect password" });

        return done(null, admin);

      } catch (err) {
        return done(err);
      }
    }
  )
);


passport.serializeUser((user, done) => {
  const type = user instanceof Admin ? "admin" : "user";
  done(null, { id: user._id, type });
});

passport.deserializeUser(async (obj, done) => {
  try {
    if (obj.type === "admin") {
      const admin = await Admin.findById(obj.id);
      return done(null, admin);
    }

    const user = await User.findById(obj.id);
    return done(null, user);

  } catch (err) {
    done(err);
  }
});
