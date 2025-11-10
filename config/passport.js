import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcrypt";
import User from "../models/User.js"; // adjust path if needed

// Local Strategy (login with email + password)
passport.use(new LocalStrategy(
  {
    usernameField: "email",
    passwordField: "password",
  },
  async (email, password, done) => {
    try {
      // Find user by email
      const user = await User.findOne({ email });
      if (!user) {
        return done(null, false, { message: "No user found with that email" });
      }

      // Compare password
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return done(null, false, { message: "Incorrect password" });
      }

      // Success
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

// Serialize user -> store user ID in session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize user -> retrieve user by ID from session
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

export default passport;
