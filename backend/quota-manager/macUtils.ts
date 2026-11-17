const MAC_REGEX = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

export function normalizeMac(raw: string): string {
  const trimmed = raw.trim();
  if (!MAC_REGEX.test(trimmed)) {
    throw new Error('عنوان MAC غير صالح');
  }
  return trimmed.replace(/-/g, ':').toUpperCase();
}

export interface DetectedDeviceInfo {
  deviceName: string | null;
  deviceType: string | null;
  deviceModel: string | null;
}

/**
 * Extracts only reliable device type/model from User-Agent when present.
 * Never fabricates a device name or model if unavailable.
 */
export function detectDeviceFromUserAgent(userAgent?: string | null): DetectedDeviceInfo {
  if (!userAgent || !userAgent.trim()) {
    return { deviceName: null, deviceType: null, deviceModel: null };
  }
  const ua = userAgent;

  if (/iPhone/i.test(ua)) {
    return { deviceName: null, deviceType: 'هاتف ذكي (iOS)', deviceModel: 'iPhone' };
  }
  if (/iPad/i.test(ua)) {
    return { deviceName: null, deviceType: 'جهاز لوحي (iPadOS)', deviceModel: 'iPad' };
  }
  if (/Android/i.test(ua)) {
    const isMobile = /Mobile/i.test(ua);
    return {
      deviceName: null,
      deviceType: isMobile ? 'هاتف ذكي (Android)' : 'جهاز لوحي (Android)',
      deviceModel: null,
    };
  }
  if (/Windows NT/i.test(ua)) {
    return { deviceName: null, deviceType: 'حاسوب (Windows)', deviceModel: null };
  }
  if (/Macintosh|Mac OS X/i.test(ua)) {
    return { deviceName: null, deviceType: 'حاسوب (macOS)', deviceModel: null };
  }
  if (/Linux/i.test(ua)) {
    return { deviceName: null, deviceType: 'حاسوب (Linux)', deviceModel: null };
  }

  return { deviceName: null, deviceType: null, deviceModel: null };
}
