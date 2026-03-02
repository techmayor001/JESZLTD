const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: true, // REQUIRED for port 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Verify connection on startup
transporter.verify((error) => {
  if (error) {
    console.error("❌ SMTP connection failed:", error);
  } else {
    console.log("✅ Hostinger mail server connected");
  }
});

async function sendEmail({ to, subject, html }) {
  return transporter.sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject,
    html,
  });
}

module.exports = sendEmail;
