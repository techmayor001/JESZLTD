// utils/loanTime.js

function computeDueDate(baseDate, value, unit) {
  const base = new Date(baseDate).getTime();

  const multipliers = {
    minutes: 60 * 1000,
    hours:   60 * 60 * 1000,
    days:    24 * 60 * 60 * 1000,
    months:  30 * 24 * 60 * 60 * 1000 // financial month
  };

  const durationMs = (multipliers[unit] || multipliers.days) * Number(value);

  return new Date(base + durationMs);
}

module.exports = { computeDueDate };