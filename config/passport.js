const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcrypt");
const User = require("../models/User");

/* ============================================================
   LOCAL STRATEGY (Named "user-local")
============================================================ */
passport.use(
  "user-local",
  new LocalStrategy(
    {
      usernameField: "email",
      passwordField: "password",
    },
    async (email, password, done) => {
      try {
        const normalizedEmail = email.toLowerCase().trim();

        const user = await User.findOne({ email: normalizedEmail })
          .select("+password")
          .populate({
            path: "role",
            populate: { path: "permissions" },
          });

        if (!user) {
          return done(null, false, { message: "No user found" });
        }

        if (!user.password) {
          return done(null, false, { message: "Incorrect password" });
        }

        const match = await bcrypt.compare(password, user.password);

        if (!match) {
          return done(null, false, { message: "Incorrect password" });
        }

        if (!user.role) {
          return done(null, false, { message: "No role assigned" });
        }

        if (!user.role.isActive) {
          return done(null, false, { message: "User role is inactive" });
        }

        return done(null, user);

      } catch (err) {
        return done(err);
      }
    }
  )
);

/* ============================================================
   SERIALIZATION
============================================================ */
passport.serializeUser((user, done) => {
  done(null, user._id);
});

/* ============================================================
   DESERIALIZATION
============================================================ */
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id)
      .populate({
        path: "role",
        populate: { path: "permissions" },
      });

    if (!user) return done(null, false);

    done(null, user);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;
