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

export function getTodayDateString(timeZone = 'Asia/Kolkata') {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(now);
  } catch (e) {
    const now = new Date();
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(now.getTime() + (now.getTimezoneOffset() * 60 * 1000) + istOffsetMs);
    const y = istDate.getFullYear();
    const m = String(istDate.getMonth() + 1).padStart(2, '0');
    const d = String(istDate.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}

export function getDayRangeInTimezone(dateStr, timeZone = 'Asia/Kolkata') {
  const targetDate = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : getTodayDateString(timeZone);
  const [year, month, day] = targetDate.split('-').map(Number);

  // Reference UTC timestamp for noon of that date
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  let offsetMinutes = 330; // Default IST: +05:30
  try {
    const tzFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric'
    });
    const parts = tzFormatter.formatToParts(noonUtc);
    const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value;
    if (offsetPart) {
      const match = offsetPart.match(/GMT([+-])(\d+)(?::(\d+))?/);
      if (match) {
        const sign = match[1] === '+' ? 1 : -1;
        const hours = parseInt(match[2], 10);
        const mins = match[3] ? parseInt(match[3], 10) : 0;
        offsetMinutes = sign * (hours * 60 + mins);
      }
    }
  } catch (e) {}

  const startUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - (offsetMinutes * 60 * 1000);
  const endUtcMs = Date.UTC(year, month - 1, day, 23, 59, 59, 999) - (offsetMinutes * 60 * 1000);

  return {
    startIso: new Date(startUtcMs).toISOString(),
    endIso: new Date(endUtcMs).toISOString()
  };
}
