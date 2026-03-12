const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");


const KiddiesAccount = require('../../models/Kiddies/kiddiesAccount');
const KiddiesTransaction = require('../../models/Kiddies/kiddiesTransaction');

// HANDLING APPROVAL OF ACCESS TO ADMIN DASHBOARD - MIDDLEWARE ------------- TECHMAYOR COMPANY LIMITED 
function ensureAdmin(requiredPermission = null) {
  return (req, res, next) => {

    // Helper: decide response type automatically
    const deny = (reason, status = 403) => {
      const wantsJSON =
        req.xhr ||                              // ajax (older)
        req.headers.accept?.includes("json") || // fetch / api
        req.headers["content-type"] === "application/json";

      if (wantsJSON) {
        return res.status(status).json({
          success: false,
          reason
        });
      }

      return res.status(status).render("auth/forbidden", {
        reason,
        user: req.user
      });
    };

    // ✅ Not authenticated
    if (!req.isAuthenticated()) {
      const wantsJSON =
        req.xhr ||
        req.headers.accept?.includes("json");

      if (wantsJSON) {
        return res.status(401).json({
          success: false,
          message: "Authentication required"
        });
      }

      return res.redirect(
        `/login?redirect=${encodeURIComponent(req.originalUrl)}`
      );
    }

    // ✅ No role
    if (!req.user.role) {
      return deny("norole");
    }

    // ✅ Role inactive
    if (!req.user.role.isActive) {
      return deny("inactive");
    }

    // ❌ Block members completely
    if (req.user.role.name === "member") {
      return deny("member");
    }

    // ✅ Permission check
    if (requiredPermission) {
      const hasPermission = req.user.role.permissions?.some(
        perm => perm.name === requiredPermission
      );

      if (!hasPermission) {
        return deny("permission");
      }
    }

    return next();
  };
}
// ENDS HERE









// ─────────────────────────────────────────────
// GET /admin/kiddies-accounts  —  Main admin page
// ─────────────────────────────────────────────
router.get('/admin/kiddies-accounts', ensureAdmin('view_members'), async (req, res) => {
    try {
        const kiddiesAccounts = await KiddiesAccount.find()
            .populate('parent', 'firstName lastName email phone membershipID displayPicture')
            .populate('account')
            .sort({ createdAt: -1 })
            .lean();

        // Attach recent transactions count per account
        for (const ka of kiddiesAccounts) {
            ka.transactionCount = await KiddiesTransaction.countDocuments({ kiddiesAccount: ka._id });
            ka.pendingTransactionCount = await KiddiesTransaction.countDocuments({ kiddiesAccount: ka._id, status: 'pending' });
        }

        // Summary stats
        const stats = {
            total: kiddiesAccounts.length,
            active: kiddiesAccounts.filter(k => k.status === 'active').length,
            locked: kiddiesAccounts.filter(k => k.status === 'locked' && k.registrationStatus === 'paid').length,
            pending: kiddiesAccounts.filter(k => k.registrationStatus === 'pending').length,
            totalBalance: kiddiesAccounts.reduce((sum, k) => sum + (k.account?.balance || 0), 0),
            totalInterest: kiddiesAccounts.reduce((sum, k) => sum + (k.account?.accumulativeROI || 0), 0),
        };

        res.render('dashboard/admin/kiddies-accounts', {
            admin: req.user,
            kiddiesAccounts,
            stats
        });
    } catch (err) {
        console.error('Admin kiddies page error:', err);
        res.status(500).send('Server error loading kiddies accounts');
    }
});

// ─────────────────────────────────────────────
// GET /api/admin/kiddies/:id  —  Single account detail
// ─────────────────────────────────────────────
router.get('/api/admin/kiddies/:id', ensureAdmin('view_members'), async (req, res) => {
    try {
        const account = await KiddiesAccount.findById(req.params.id)
            .populate('parent', 'firstName lastName email phone membershipID displayPicture address state lga')
            .populate('account')
            .lean();

        if (!account) return res.status(404).json({ message: 'Account not found' });

        const transactions = await KiddiesTransaction.find({ kiddiesAccount: req.params.id })
            .sort({ createdAt: -1 })
            .limit(20)
            .lean();

        res.json({ account, transactions });
    } catch (err) {
        console.error('Admin kiddies detail error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// ─────────────────────────────────────────────
// GET /api/admin/kiddies/:id/transactions  —  All transactions
// ─────────────────────────────────────────────
router.get('/api/admin/kiddies/:id/transactions', ensureAdmin('view_members'), async (req, res) => {
    try {
        const transactions = await KiddiesTransaction.find({ kiddiesAccount: req.params.id })
            .sort({ createdAt: -1 })
            .lean();
        res.json({ transactions });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

// ─────────────────────────────────────────────
// POST /api/admin/kiddies/:id/approve  —  Approve account
// ─────────────────────────────────────────────
router.post('/api/admin/kiddies/:id/approve', ensureAdmin('approve_members'), async (req, res) => {
    try {
        const ka = await KiddiesAccount.findById(req.params.id).populate('parent');
        if (!ka) return res.status(404).json({ message: 'Account not found' });

        if (ka.registrationStatus !== 'paid') {
            return res.status(400).json({ message: 'Cannot approve unpaid account. Payment must be completed first.' });
        }

        ka.status = 'active';
        ka.approvedAt = new Date();
        ka.approvedBy = req.user._id;
        if (req.body.note) ka.adminNote = req.body.note;
        await ka.save();

        res.json({
            message: 'Kiddies account approved successfully',
            accountID: ka.accountID,
            childName: `${ka.childFirstName} ${ka.childLastName}`,
            parentName: `${ka.parent.firstName} ${ka.parent.lastName}`
        });
    } catch (err) {
        console.error('Approve kiddies error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// ─────────────────────────────────────────────
// POST /api/admin/kiddies/:id/decline  —  Decline / lock account
// ─────────────────────────────────────────────
router.post('/api/admin/kiddies/:id/decline', ensureAdmin('approve_members'), async (req, res) => {
    try {
        const ka = await KiddiesAccount.findById(req.params.id).populate('parent');
        if (!ka) return res.status(404).json({ message: 'Account not found' });

        ka.status = 'locked';
        ka.declinedAt = new Date();
        ka.declinedBy = req.user._id;
        ka.declineReason = req.body.reason || 'Not specified';
        if (req.body.note) ka.adminNote = req.body.note;
        await ka.save();

        res.json({ message: 'Kiddies account declined', accountID: ka.accountID });
    } catch (err) {
        console.error('Decline kiddies error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// ─────────────────────────────────────────────
// POST /api/admin/kiddies/:id/approve-transaction  —  Approve pending deposit
// ─────────────────────────────────────────────
router.post('/api/admin/kiddies/:id/approve-transaction', ensureAdmin('approve_members'), async (req, res) => {
    try {
        const { transactionId } = req.body;
        const tx = await KiddiesTransaction.findById(transactionId);
        if (!tx) return res.status(404).json({ message: 'Transaction not found' });
        if (tx.status !== 'pending') return res.status(400).json({ message: 'Transaction is not pending' });

        // Credit the account
        const acct = await Account.findById(tx.account || (await KiddiesAccount.findById(req.params.id)).account);
        if (acct) {
            acct.balance = (acct.balance || 0) + tx.amount;
            await acct.save();
        }

        tx.status = 'completed';
        tx.balanceAfter = acct ? acct.balance : 0;
        tx.approvedBy = req.user._id;
        tx.approvedAt = new Date();
        await tx.save();

        res.json({ message: 'Transaction approved and balance credited', amount: tx.amount });
    } catch (err) {
        console.error('Approve transaction error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// ─────────────────────────────────────────────
// POST /api/admin/kiddies/:id/decline-transaction  —  Decline pending deposit
// ─────────────────────────────────────────────
router.post('/api/admin/kiddies/:id/decline-transaction', ensureAdmin('approve_members'), async (req, res) => {
    try {
        const { transactionId, reason } = req.body;
        const tx = await KiddiesTransaction.findById(transactionId);
        if (!tx) return res.status(404).json({ message: 'Transaction not found' });

        tx.status = 'failed';
        tx.declineReason = reason || 'Declined by admin';
        tx.declinedBy = req.user._id;
        tx.declinedAt = new Date();
        await tx.save();

        res.json({ message: 'Transaction declined' });
    } catch (err) {
        console.error('Decline transaction error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// ─────────────────────────────────────────────
// POST /api/admin/kiddies/:id/add-note  —  Add admin note
// ─────────────────────────────────────────────
router.post('/api/admin/kiddies/:id/add-note', ensureAdmin('view_members'), async (req, res) => {
    try {
        const ka = await KiddiesAccount.findById(req.params.id);
        if (!ka) return res.status(404).json({ message: 'Account not found' });
        ka.adminNote = req.body.note;
        await ka.save();
        res.json({ message: 'Note saved' });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

// ─────────────────────────────────────────────
// POST /api/admin/kiddies/:id/close  —  Close account
// ─────────────────────────────────────────────
router.post('/api/admin/kiddies/:id/close', ensureAdmin('delete_members'), async (req, res) => {
    try {
        const ka = await KiddiesAccount.findById(req.params.id);
        if (!ka) return res.status(404).json({ message: 'Account not found' });
        ka.status = 'closed';
        ka.closedAt = new Date();
        ka.closedBy = req.user._id;
        ka.closeReason = req.body.reason || 'Closed by admin';
        await ka.save();
        res.json({ message: 'Account closed successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});






module.exports = router;
