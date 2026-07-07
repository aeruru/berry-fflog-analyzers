export function formatDateRange(startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const date = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(start);
  const times = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date}, ${times.format(start)} - ${times.format(end)}`;
}

export function formatShortDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

export function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

export function formatEventTime(milliseconds) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(milliseconds));
}

export function formatFightCount(count) {
  return `${count} ${count === 1 ? 'fight' : 'fights'}`;
}

export function formatPhaseLabel(phase) {
  return phase.replace(/^Phase\s+(\d+)$/i, 'Phase$1');
}

export function estimatePhase(progress) {
  if (progress >= 85) return 'Final phase';
  if (progress >= 65) return 'Phase 4';
  if (progress >= 45) return 'Phase 3';
  if (progress >= 22) return 'Phase 2';
  return 'Phase 1';
}

export function renderEventIcon(kind) {
  if (kind === 'death') {
    return '<span aria-label="Death" title="Death">💀</span>';
  }

  return '<img class="damage-down-icon" src="assets/damage-down.png" alt="Damage down" title="Damage down">';
}

export function getFflogsReportUrl(reportCode) {
  return `https://www.fflogs.com/reports/${encodeURIComponent(reportCode)}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
