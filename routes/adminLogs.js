const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Role = require("../models/Role");
const { AdminActionLog } = require("../models/ReportSchemas");

// ══════════════════════════════════════════════════════════
// MIDDLEWARE - Ensure Admin Access
// ══════════════════════════════════════════════════════════
function ensureAdmin(requiredPermission = null) {
  return (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.redirect(
        `/login?redirect=${encodeURIComponent(req.originalUrl)}`
      );
    }

    if (!req.user.role) {
      return res.status(403).render("auth/forbidden", {
        reason: "norole",
        user: req.user,
      });
    }

    if (!req.user.role.isActive) {
      return res.status(403).render("auth/forbidden", {
        reason: "inactive",
        user: req.user,
      });
    }

    // ❌ Block members completely
    if (req.user.role.name === "member") {
      return res.status(403).render("auth/forbidden", {
        reason: "member",
        user: req.user,
      });
    }

    // ✅ If permission is required, check it
    if (requiredPermission) {
      const hasPermission = req.user.role.permissions.some(
        (perm) => perm.name === requiredPermission
      );

      if (!hasPermission) {
        return res.status(403).render("auth/forbidden", {
          reason: "permission",
          user: req.user,
        });
      }
    }

    return next();
  };
}

// ══════════════════════════════════════════════════════════
// HELPER - Build Date Range Filter
// ══════════════════════════════════════════════════════════
function buildDateFilter(dateFrom, dateTo, field = "createdAt") {
  const filter = {};
  
  if (dateFrom || dateTo) {
    filter[field] = {};
    
    if (dateFrom) {
      const start = new Date(dateFrom);
      start.setHours(0, 0, 0, 0);
      filter[field].$gte = start;
    }
    
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      filter[field].$lte = end;
    }
  }
  
  return filter;
}

// ══════════════════════════════════════════════════════════
// GET /admin/logs
// Main logs page with server-side rendering
// ══════════════════════════════════════════════════════════
router.get(
  "/admin/logs",
  ensureAdmin("view_logs"), // Use appropriate permission
  async (req, res) => {
    try {
      const {
        dateFrom,
        dateTo,
        actionType,
        adminId,
        page = 1,
        limit = 50,
      } = req.query;

      // ── Build filter object ──
      const filter = { ...buildDateFilter(dateFrom, dateTo) };
      
      if (actionType && actionType.trim()) {
        filter.actionType = actionType;
      }
      
      if (adminId && adminId.trim()) {
        filter.admin = adminId;
      }

      // ── Pagination ──
      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.max(1, Math.min(100, parseInt(limit)));
      const skip = (pageNum - 1) * limitNum;

      // ── Fetch logs ──
      const [logs, total] = await Promise.all([
        AdminActionLog.find(filter)
          .populate({
            path: "admin",
            select: "firstName lastName membershipID email",
            populate: { path: "role", select: "name" },
          })
          .populate("targetUser", "firstName lastName membershipID")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
        AdminActionLog.countDocuments(filter),
      ]);

      // ── Calculate stats for current filter ──
      const statsPromises = [
        AdminActionLog.countDocuments({ ...filter, status: "success" }),
        AdminActionLog.countDocuments({ ...filter, status: "failed" }),
        AdminActionLog.distinct("admin", filter).then(arr => arr.length),
      ];

      const [successCount, failedCount, uniqueAdmins] = await Promise.all(statsPromises);

      // ── Get list of all admins (non-members) for filter dropdown ──
      const memberRole = await Role.findOne({ name: /^member$/i }).select("_id");
      const admins = await User.find({
        role: { $ne: memberRole?._id },
        status: "active",
      })
        .populate("role", "name")
        .select("firstName lastName membershipID role")
        .sort({ firstName: 1 })
        .lean();

      // ── Render page ──
      res.render("dashboard/admin/logs", {
        admin: req.user,
        pageTitle: "Admin Logs",
        logs,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum),
        },
        stats: {
          total,
          success: successCount,
          failed: failedCount,
          uniqueAdmins,
        },
        admins,
        filters: {
          dateFrom: dateFrom || '',
          dateTo: dateTo || '',
          actionType: actionType || '',
          adminId: adminId || '',
        },
      });

    } catch (error) {
      console.error("Error loading logs page:", error);
      res.status(500).send("Internal Server Error");
    }
  }
);

// ══════════════════════════════════════════════════════════
// GET /admin/logs/export
// Export logs as CSV
// ══════════════════════════════════════════════════════════
router.get(
  "/admin/logs/export",
  ensureAdmin("view_logs"),
  async (req, res) => {
    try {
      const {
        dateFrom,
        dateTo,
        actionType,
        adminId,
      } = req.query;

      // ── Build filter ──
      const filter = { ...buildDateFilter(dateFrom, dateTo) };
      
      if (actionType && actionType.trim()) {
        filter.actionType = actionType;
      }
      
      if (adminId && adminId.trim()) {
        filter.admin = adminId;
      }

      // ── Fetch all matching logs (no pagination for export) ──
      // Limit to 10,000 records for safety
      const logs = await AdminActionLog.find(filter)
        .populate({
          path: "admin",
          select: "firstName lastName membershipID email",
          populate: { path: "role", select: "name" },
        })
        .populate("targetUser", "firstName lastName membershipID")
        .sort({ createdAt: -1 })
        .limit(10000)
        .lean();

      // ── Generate CSV ──
      const headers = [
        "Date",
        "Time",
        "Admin Name",
        "Admin ID",
        "Admin Role",
        "Action Type",
        "Description",
        "Target User",
        "Target User ID",
        "Status",
        "IP Address",
        "User Agent"
      ];

      let csv = headers.join(",") + "\n";

      logs.forEach(log => {
        const date = new Date(log.createdAt);
        const dateStr = date.toLocaleDateString("en-NG");
        const timeStr = date.toLocaleTimeString("en-NG");
        
        const adminName = log.admin 
          ? `${log.admin.firstName} ${log.admin.lastName}` 
          : "System";
        const adminId = log.admin?.membershipID || "";
        const adminRole = log.adminRole || "";
        
        const targetUser = log.targetUser 
          ? `${log.targetUser.firstName} ${log.targetUser.lastName}`
          : "";
        const targetUserId = log.targetUser?.membershipID || "";

        const row = [
          escapeCSV(dateStr),
          escapeCSV(timeStr),
          escapeCSV(adminName),
          escapeCSV(adminId),
          escapeCSV(adminRole),
          escapeCSV(log.actionType),
          escapeCSV(log.description),
          escapeCSV(targetUser),
          escapeCSV(targetUserId),
          escapeCSV(log.status),
          escapeCSV(log.ipAddress || ""),
          escapeCSV(log.userAgent || "")
        ];

        csv += row.join(",") + "\n";
      });

      // ── Send CSV ──
      const filename = `admin-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);

    } catch (error) {
      console.error("Error exporting logs:", error);
      return res.status(500).json({ 
        error: "Failed to export logs",
        message: error.message 
      });
    }
  }
);

// ══════════════════════════════════════════════════════════
// POST /admin/logs/create
// Create a new log entry (used by other routes)
// ══════════════════════════════════════════════════════════
router.post(
  "/admin/logs/create",
  ensureAdmin(),
  async (req, res) => {
    try {
      const {
        actionType,
        targetUser,
        targetModel,
        targetId,
        description,
        changes,
        status = "success",
        errorMessage,
      } = req.body;

      // Validate required fields
      if (!actionType || !description) {
        return res.status(400).json({ 
          error: "actionType and description are required" 
        });
      }

      // Get IP and User Agent
      const ipAddress = req.ip || 
                       req.headers["x-forwarded-for"]?.split(",")[0] || 
                       req.connection.remoteAddress;
      const userAgent = req.headers["user-agent"];

      // Create log entry
      const log = await AdminActionLog.create({
        admin: req.user._id,
        adminRole: req.user.role?.name || "Unknown",
        actionType,
        targetUser: targetUser || null,
        targetModel: targetModel || null,
        targetId: targetId || null,
        description,
        changes: changes || null,
        status,
        errorMessage: errorMessage || null,
        ipAddress,
        userAgent,
      });

      return res.status(201).json({ 
        success: true, 
        logId: log._id 
      });

    } catch (error) {
      console.error("Error creating log entry:", error);
      return res.status(500).json({ 
        error: "Failed to create log entry",
        message: error.message 
      });
    }
  }
);

// ══════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ══════════════════════════════════════════════════════════

/**
 * Escape CSV fields to handle commas, quotes, and newlines
 */
function escapeCSV(field) {
  if (field == null) return "";
  
  const str = String(field);
  
  // If field contains comma, quote, or newline, wrap in quotes and escape quotes
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  
  return str;
}

/**
 * Helper function to create log entries from other routes
 * Usage: await logAdminAction(req, { actionType, description, targetUser, ... })
 */
async function logAdminAction(req, logData) {
  try {
    const ipAddress = req.ip || 
                     req.headers["x-forwarded-for"]?.split(",")[0] || 
                     req.connection.remoteAddress;
    const userAgent = req.headers["user-agent"];

    await AdminActionLog.create({
      admin: req.user._id,
      adminRole: req.user.role?.name || "Unknown",
      ipAddress,
      userAgent,
      status: "success",
      ...logData,
    });
  } catch (error) {
    console.error("Failed to create admin log:", error);
    // Don't throw - logging failure shouldn't break the main operation
  }
}

// ══════════════════════════════════════════════════════════
// EXPORT
// ══════════════════════════════════════════════════════════
module.exports = router;

// Export the helper function for use in other routes
module.exports.logAdminAction = logAdminAction;