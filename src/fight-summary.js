// Calculates pull summaries and renders the compact progress badges used across report views.
import { DMU_ENCOUNTER_ID } from './config.js';
import { formatFightDuration } from './format.js';

export function isDmuPull(fight) {
  return Number(fight.encounterID) === DMU_ENCOUNTER_ID;
}

export function getBestDmuPull(pulls) {
  if (pulls.length === 0) return null;

  return [...pulls].sort((first, second) => {
    if (first.kill !== second.kill) return first.kill ? -1 : 1;
    if (first.kill && second.kill) return getFightDuration(first) - getFightDuration(second);

    const phaseDifference = (Number(second.lastPhase) || 0) - (Number(first.lastPhase) || 0);
    if (phaseDifference !== 0) return phaseDifference;
    const healthDifference = normalizeBossHealth(first) - normalizeBossHealth(second);
    return healthDifference || getFightDuration(second) - getFightDuration(first);
  })[0];
}

export function normalizeBossHealth(fight) {
  const health = Number(fight.bossPercentage);
  return Number.isFinite(health) ? (health > 100 ? health / 100 : health) : 100;
}

export function getFightDuration(fight) {
  return Math.max(0, Number(fight.endTime) - Number(fight.startTime));
}

export function createBestPullBadge(pull, emptyLabel = 'No DMU pulls') {
  const badge = document.createElement('span');
  badge.className = `best-pull-badge ${getPullColorClass(pull)}`;

  const icon = document.createElement('span');
  icon.className = `best-pull-icon ${!pull ? 'no-pull-icon' : pull.kill ? 'clear-icon' : 'failure-icon'}`;
  icon.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.className = 'best-pull-text';
  if (!pull) {
    text.textContent = emptyLabel;
  } else if (pull.kill) {
    text.textContent = formatFightDuration(getFightDuration(pull));
  } else {
    const phase = Number(pull.lastPhase) || 1;
    const phaseLabel = pull.lastPhaseIsIntermission ? `I${phase}` : `P${phase}`;
    text.textContent = `${normalizeBossHealth(pull).toFixed(1)}% ${phaseLabel}`;
  }

  badge.append(icon, text);
  return badge;
}

export function getPullColorClass(pull) {
  if (!pull) return 'phase-unknown';
  if (pull.kill) return 'phase-clear';
  if (pull.lastPhaseIsIntermission) return 'phase-intermission';
  const phase = Number(pull.lastPhase);
  return phase > 0 ? `phase-${((phase - 1) % 6) + 1}` : 'phase-unknown';
}
