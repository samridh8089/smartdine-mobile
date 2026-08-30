/**
 * CleverOps Canonical Global Exact Timestamp Formatter for React Native Mobile App
 * Format: "DD MMM YYYY • HH:MM:SS AM/PM" (e.g. "13 Aug 2026 • 12:18:42 PM")
 * Timezone: Asia/Kolkata (IST) for consistent cross-surface rendering
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatExactTimestamp(dateInput) {
  if (!dateInput) return '';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return '';

  // Format in IST (Asia/Kolkata: UTC + 5:30)
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + (date.getTimezoneOffset() * 60 * 1000) + istOffsetMs);

  const day = String(istDate.getDate()).padStart(2, '0');
  const month = MONTHS[istDate.getMonth()];
  const year = istDate.getFullYear();

  let hours = istDate.getHours();
  const minutes = String(istDate.getMinutes()).padStart(2, '0');
  const seconds = String(istDate.getSeconds()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';

  hours = hours % 12;
  hours = hours ? hours : 12; // hour 0 should be 12
  const strHours = String(hours).padStart(2, '0');

  return `${day} ${month} ${year} • ${strHours}:${minutes}:${seconds} ${ampm}`;
}

export function formatExactTimeOnly(dateInput) {
  if (!dateInput) return '';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return '';

  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + (date.getTimezoneOffset() * 60 * 1000) + istOffsetMs);

  let hours = istDate.getHours();
  const minutes = String(istDate.getMinutes()).padStart(2, '0');
  const seconds = String(istDate.getSeconds()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';

  hours = hours % 12;
  hours = hours ? hours : 12;
  const strHours = String(hours).padStart(2, '0');

  return `${strHours}:${minutes}:${seconds} ${ampm}`;
}

export function formatExactDateOnly(dateInput) {
  if (!dateInput) return '';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return '';

  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + (date.getTimezoneOffset() * 60 * 1000) + istOffsetMs);

  const day = String(istDate.getDate()).padStart(2, '0');
  const month = MONTHS[istDate.getMonth()];
  const year = istDate.getFullYear();

  return `${day} ${month} ${year}`;
}
