// Helpers para mascarar PII em logs (Sprint 2 / T5).

function maskPhone(phone) {
  if (!phone) return '';
  const s = String(phone).replace(/\D/g, '');
  if (s.length <= 8) return '****';
  const first = s.slice(0, 4);
  const last = s.slice(-4);
  return `${first}****${last}`;
}

function maskName(name) {
  if (!name) return '';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = parts[0];
  const initials = parts.slice(1).map(p => (p[0] || '').toUpperCase() + '.').join(' ');
  return initials ? `${first} ${initials}` : first;
}

function maskMessage(msg, maxChars = 30) {
  if (!msg) return '';
  const s = String(msg).replace(/\s+/g, ' ').trim();
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars) + '...';
}

module.exports = { maskPhone, maskName, maskMessage };
