const mongoose = require("mongoose");


const adminSettingsSchema = new mongoose.Schema({
    loanCheck: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("AdminSettings", adminSettingsSchema);
