export function formatDateRange(startTime, endTime) {
  const start = toValidDate(startTime);
  const end = toValidDate(endTime);
  if (!start || !end) return 'Invalid date';

  const dates = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  const times = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const startLabel = `${dates.format(start)}, ${times.format(start)}`;
  const endLabel = start.toDateString() === end.toDateString()
    ? times.format(end)
    : `${dates.format(end)}, ${times.format(end)}`;
  return `${startLabel} - ${endLabel}`;
}

export function formatShortDate(value) {
  const date = toValidDate(value);
  if (!date) return 'Invalid date';

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function formatTime(value) {
  const date = toValidDate(value);
  if (!date) return 'Invalid date';

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

export function formatEventTime(milliseconds) {
  const date = toValidDate(milliseconds);
  if (!date) return 'Invalid date';

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function toValidDate(value) {
  if (value === null || value === undefined || value === '') return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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

export function formatFightPhaseTag(fight) {
  if (fight.kill) {
    return 'CLR';
  }

  if (fight.lastPhase) {
    return fight.lastPhaseIsIntermission ? `I${fight.lastPhase}` : `P${fight.lastPhase}`;
  }

  return '?';
}

export function getFightPhaseTagClass(fight) {
  if (fight.kill) {
    return 'phase-clear';
  }

  if (fight.lastPhaseIsIntermission) {
    return 'phase-intermission';
  }

  if (fight.lastPhase) {
    return `phase-${((Number(fight.lastPhase) - 1) % 6) + 1}`;
  }

  return 'phase-unknown';
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

export function getFflogsFightUrl(reportCode, fightId) {
  const params = new URLSearchParams({
    fight: String(fightId),
  });
  return `${getFflogsReportUrl(reportCode)}?${params.toString()}`;
}

export function getForsakenAnalyzerUrl(reportCode, fightId) {
  const params = new URLSearchParams({
    report: reportCode,
    fight: String(fightId),
  });
  return `https://analyzer.wtfdig.info/forsaken?${params.toString()}`;
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
