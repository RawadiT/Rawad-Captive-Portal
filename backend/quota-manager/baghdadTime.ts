const baghdadDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Baghdad',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Returns YYYY-MM-DD in Asia/Baghdad (UTC+3).
 */
export function getBaghdadDateString(date: Date = new Date()): string {
  return baghdadDateFormatter.format(date);
}

/**
 * Returns the ISO UTC timestamp for the next 00:00:00 Asia/Baghdad.
 * Iraq (Asia/Baghdad) is permanently UTC+3 without DST.
 */
export function getNextBaghdadMidnightIso(date: Date = new Date()): string {
  const baghdadDate = getBaghdadDateString(date);
  const [y, m, d] = baghdadDate.split('-').map(Number);
  // 00:00:00+03:00 on (y, m, d + 1) is UTC (d + 1) minus 3 hours
  const nextMidnightUtcMs = Date.UTC(y, m - 1, d + 1, 0, 0, 0) - 3 * 3600 * 1000;
  return new Date(nextMidnightUtcMs).toISOString();
}
