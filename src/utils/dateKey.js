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
  if (leading) {
    const candidate = `${leading[1]}-${leading[2]}-${leading[3]}`;
    // Reject real-world impossible values a database can still hold, such as the
    // MySQL "zero date" '0000-00-00' or '2026-02-30' (which would silently roll
    // over to March). An unreadable date must return '' so callers skip the row
    // instead of comparing it against a range it can never match.
    const parsed = new Date(`${candidate}T00:00:00Z`);
    if (!isValidDate(parsed)) return '';
    const roundTrip = `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(
      2,
      '0'
    )}-${String(parsed.getUTCDate()).padStart(2, '0')}`;
    return roundTrip === candidate ? candidate : '';
  }

  // Anything else textual ('Wed Nov 04 2026 00:00:00 GMT+0000', '11/04/2026', ...) - let
  // the platform parse it, then read the day back in UTC so the result is stable.
  const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  return isValidDate(parsed) ? toDateKey(parsed) : '';
}

module.exports = { toDateKey, isValidDate };
