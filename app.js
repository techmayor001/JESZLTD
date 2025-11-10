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
  .then((done) => {
    let port = process.env.PORT || 3001;
    if(port == null || port == ""){
      port = 3001
    }
    app.listen(port, () => console.log(`Server running on Port ${port}`));

    console.log("Db connected");
  })
.catch((err) => console.log(err));


app.use(require("./routes/main"));
app.use(require("./routes/auth"));
app.use(require("./routes/transaction"));