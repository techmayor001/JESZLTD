const mongoose = require("mongoose");

const roleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    description: {
      type: String,
      trim: true,
    },

    permissions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Permission",
      },
    ],

    isSystemRole: {
      type: Boolean,
      default: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

/* ============================================================
   Prevent Deleting System Roles
============================================================ */
roleSchema.pre("deleteOne", { document: true }, function (next) {
  if (this.isSystemRole) {
    return next(new Error("System roles cannot be deleted"));
  }
  next();
});

/* ============================================================
   Prevent Disabling System Roles
============================================================ */
roleSchema.pre("save", function (next) {
  if (this.isSystemRole && this.isModified("isActive") && !this.isActive) {
    return next(new Error("System roles cannot be deactivated"));
  }
  next();
});

module.exports = mongoose.model("Role", roleSchema);
