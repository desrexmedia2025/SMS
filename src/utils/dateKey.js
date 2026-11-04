/**
 * Date helpers that accept whatever a database driver hands back.
 *
 * MySQL (mysql2) can return DATE and DATETIME columns as JavaScript `Date` objects while
 * SQLite returns plain `YYYY-MM-DD` strings. Anything that slices a date column as text
 * therefore has to normalise first, otherwise the calendar silently drops every event.
 */

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * @param {Date|string|number} value
 * @returns {string} `YYYY-MM-DD`, or '' when the value cannot be read as a date
 */
function toDateKey(value) {
  if (value === null || value === undefined || value === '') return '';

  if (isValidDate(value)) {
    // Read the calendar day the value falls on, without letting the host timezone
    // shift it: DATE columns arrive at midnight UTC.
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(
      value.getUTCDate()
    ).padStart(2, '0')}`;
  }

  if (typeof value === 'number') {
    const fromNumber = new Date(value);
    return isValidDate(fromNumber) ? toDateKey(fromNumber) : '';
  }

  const raw = String(value).trim();
  if (!raw) return '';

  // 'YYYY-MM-DD', 'YYYY-MM-DD HH:MM:SS', 'YYYY-MM-DDTHH:MM:SSZ', ...
  const leading = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (leading) return `${leading[1]}-${leading[2]}-${leading[3]}`;

  // Anything else textual ('Wed Nov 04 2026 00:00:00 GMT+0000', '11/04/2026', ...) - let
  // the platform parse it, then read the day back in UTC so the result is stable.
  const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  return isValidDate(parsed) ? toDateKey(parsed) : '';
}

module.exports = { toDateKey, isValidDate };
