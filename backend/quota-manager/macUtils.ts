const MAC_REGEX = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

export function normalizeMac(raw: string): string {
  const trimmed = raw.trim();
  if (!MAC_REGEX.test(trimmed)) {
    throw new Error('عنوان MAC غير صالح');
  }
  return trimmed.replace(/-/g, ':').toUpperCase();
}
