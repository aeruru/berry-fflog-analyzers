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

export function formatElapsedTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function formatFightCount(count) {
  return `${count} ${count === 1 ? 'fight' : 'fights'}`;
}

export function formatPhaseLabel(phase) {
  return phase.replace(/^Phase\s+(\d+)$/i, 'Phase$1');
}

export function formatFightPhase(fight) {
  if (fight.kill) {
    return 'Clear';
  }

  if (fight.lastPhase) {
    const label = fight.lastPhaseIsIntermission ? `Intermission ${fight.lastPhase}` : `Phase ${fight.lastPhase}`;
    return formatPhaseLabel(label);
  }

  return 'Unknown phase';
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
