require("dotenv").config();
const express = require("express");
const app = express();
const path = require("path");
const mongoose = require("mongoose");

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));
const initSystem = require("./seed");




// CONNECTING PASSPORT 
const session = require("express-session");
const passport = require("passport");
require("./config/passport");

app.use(session({
    secret: process.env.SESSION_SECRET || "defaultsecret",
    resave: false,
    saveUninitialized: false,
}));
app.use(passport.initialize());
app.use(passport.session());







mongoose
  .connect(process.env.DB)
  .then(async () => {
    console.log("✅ DB connected");

    await initSystem();

    const port = process.env.PORT || 3001;

    app.listen(port, () =>
      console.log(`🚀 Server running on Port ${port}`)
    );
  })
  .catch((err) => {
    console.error("❌ Startup failed:", err);
    process.exit(1);
  });



app.use(require("./routes/main"));
app.use(require("./routes/auth"));
app.use(require("./routes/admin"));
app.use(require("./routes/transaction"));
app.use(require("./routes/kiddies"));
app.use(require("./routes/report"));
app.use(require("./routes/adminLogs"));