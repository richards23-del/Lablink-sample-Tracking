export function formatTime(value?: string | null, timeZone?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

export function formatRelative(value?: string | null, now = Date.now()) {
  if (!value) return '—';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Unknown time';
  const seconds = Math.round((timestamp - now) / 1000);
  if (Math.abs(seconds) < 60)
    return seconds > 0 ? 'in less than a minute' : 'just now';
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(seconds) < 3600)
    return formatter.format(Math.trunc(seconds / 60), 'minute');
  if (Math.abs(seconds) < 86400)
    return formatter.format(Math.trunc(seconds / 3600), 'hour');
  return formatter.format(Math.trunc(seconds / 86400), 'day');
}

export function parseSampleId(value?: string): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export function toDateTimeLocal(value: string | Date = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function barPercentage(value: number, maximum: number) {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(maximum) ||
    value <= 0 ||
    maximum <= 0
  )
    return 0;
  return Math.min(100, (value / maximum) * 100);
}
