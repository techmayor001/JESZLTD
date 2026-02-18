const mongoose = require("mongoose");

const permissionSchema = new mongoose.Schema(
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

    isSystemPermission: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

/* ============================================================
   Prevent Deleting System Permissions
============================================================ */
permissionSchema.pre("deleteOne", { document: true }, function (next) {
  if (this.isSystemPermission) {
    return next(new Error("System permissions cannot be deleted"));
  }
  next();
});

module.exports = mongoose.model("Permission", permissionSchema);
