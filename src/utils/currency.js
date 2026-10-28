const CURRENCY_CATALOGUE = [
  { code: 'GHS', symbol: 'GH₵', name: 'Ghanaian Cedi (GHS)' },
  { code: 'USD', symbol: '$', name: 'US Dollar (USD)' },
  { code: 'EUR', symbol: '€', name: 'Euro (EUR)' },
  { code: 'GBP', symbol: '£', name: 'British Pound (GBP)' },
  { code: 'NGN', symbol: '₦', name: 'Nigerian Naira (NGN)' },
  { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling (KES)' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand (ZAR)' },
  { code: 'XOF', symbol: 'CFA', name: 'West African CFA Franc (XOF)' },
  { code: 'CAD', symbol: 'CA$', name: 'Canadian Dollar (CAD)' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar (AUD)' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee (INR)' },
];

function toCents(amount) {
  const num = Number(amount);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100);
}

function fromCents(cents) {
  return (Math.round(cents) / 100).toFixed(2);
}

function normalizeDecimal(amount) {
  return fromCents(toCents(amount));
}

function formatMoney(amount, symbol = 'GH₵', code = '') {
  const num = Number(amount || 0);
  const formatted = num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return symbol ? `${symbol} ${formatted}` : `${code} ${formatted}`.trim();
}

function resolveCurrency(code, customSymbol) {
  const upper = String(code || 'GHS').trim().toUpperCase();
  const preset = CURRENCY_CATALOGUE.find((c) => c.code === upper);
  if (customSymbol && String(customSymbol).trim()) {
    return { code: upper, symbol: String(customSymbol).trim() };
  }
  if (preset) {
    return { code: preset.code, symbol: preset.symbol };
  }
  return { code: upper.slice(0, 6) || 'GHS', symbol: upper.slice(0, 6) || 'GH₵' };
}

module.exports = {
  CURRENCY_CATALOGUE,
  toCents,
  fromCents,
  normalizeDecimal,
  formatMoney,
  resolveCurrency,
};
