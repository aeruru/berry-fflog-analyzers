export function formatFightDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatReportDate(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));
}

export function formatReportDateRange(startTimestamp, endTimestamp) {
  const start = new Date(startTimestamp);
  const end = new Date(endTimestamp);
  const date = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const endLabel = start.toDateString() === end.toDateString()
    ? time.format(end)
    : `${date.format(end)}, ${time.format(end)}`;
  return `${date.format(start)}, ${time.format(start)} - ${endLabel}`;
}

export function formatFightStartTime(reportStartTime, fightStartTime) {
  const rawStart = Number(fightStartTime);
  const timestamp = rawStart < 1_700_000_000
    ? Number(reportStartTime) + rawStart
    : rawStart;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}
