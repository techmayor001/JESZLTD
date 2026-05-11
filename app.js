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
app.use((req, res, next) => {
  if (req.headers.host === 'jeszltd.com') {
    return res.redirect(301, 'https://www.jeszltd.com' + req.url);
  }
  next();
});
const globalData = require("./globalData");
const initSystem = require("./seed");


// CONNECTING PASSPORT 
const session = require("express-session");
const passport = require("passport");
require("./config/passport");
require("./jobs/LoanPenaltyCron");

app.use(session({
    secret: process.env.SESSION_SECRET || "defaultsecret",
    resave: true,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        maxAge:   1 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
    }
}));

app.use(passport.initialize());
app.use(passport.session());
  
  
  
  
  


mongoose
  .connect(process.env.DB)
  .then(async () => {
    console.log("✅ DB connected");

    await initSystem();
    
    const port = process.env.PORT || 3000;
    
    app.listen(port, () =>
      console.log(`🚀 Server running on Port ${port}`)
    );
  })
  .catch((err) => {
    console.error("❌ Startup failed:", err);
    process.exit(1);
  });


  app.use(globalData);

  app.use(require("./routes/main"));
app.use(require("./routes/auth"));
app.use(require("./routes/admin"));
app.use(require("./routes/transaction"));
app.use(require("./routes/kiddies"));
app.use(require("./routes/report"));
app.use(require("./routes/adminLogs"));
app.use(require("./routes/LoanLogic/userLoanLogic"));
app.use(require("./routes/LoanLogic/adminLoanLogic"));
app.use(require("./routes/KiddiesLogic/kiddies"));


app.use((req, res) => {
  const previousPage = req.get('Referrer') || '/';
  res.redirect(previousPage);
});