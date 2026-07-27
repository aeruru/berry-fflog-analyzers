import {
  DAMAGE_DOWN_ABILITY_ID,
  UNKNOWN_ZONE_NAMES,
} from './config.js';

// FFLogs fight timestamps can be report-relative offsets in milliseconds. This
// cutoff (~19.7 days) comfortably exceeds a report's duration while remaining
// below modern Unix timestamps in seconds.
const REPORT_RELATIVE_TIMESTAMP_CUTOFF_MS = 1_700_000_000;

// Current Unix timestamps have 10 digits in seconds and 13 in milliseconds.
// Values above 10 billion can therefore be treated as Unix milliseconds.
const UNIX_MILLISECONDS_CUTOFF = 10_000_000_000;

export function normalizeReportList(raw) {
  if (typeof raw === 'string') {
    return [];
  }

  const roots = [
    raw,
    raw?.reports,
    raw?.reportData?.reports?.data,
    raw?.userData?.user?.reports?.data,
    raw?.data,
    raw?.sessions,
  ].filter(Boolean);

  const flattened = roots.flatMap((root) => Array.isArray(root) ? root : Object.values(root));

  return flattened
    .map(normalizeSession)
    .filter(Boolean)
    .filter((session) => !UNKNOWN_ZONE_NAMES.has(session.zoneName.trim().toLowerCase()))
    .sort((a, b) => new Date(b.endTime) - new Date(a.endTime));
}

export function normalizeSession(item, index = 0) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const reportStartTime = item.startTime ?? item.start ?? item.start_time ?? item.report?.startTime;
  const pulls = normalizePulls(item.fights ?? item.encounters ?? item.pulls ?? item.report?.fights ?? [], reportStartTime);
  const startTime = toDateString(reportStartTime ?? pulls[0]?.startTime);
  const endTime = toDateString(item.endTime ?? item.end ?? item.end_time ?? item.report?.endTime ?? pulls[pulls.length - 1]?.endTime, reportStartTime);
  const zoneName = item.zoneName ?? item.zone?.name ?? item.zone ?? item.report?.zone?.name ?? item.report?.zoneName ?? 'Unknown Zone';
  const zoneId = normalizeId(item.zoneID ?? item.zoneId ?? item.zone?.id ?? item.report?.zoneID ?? item.report?.zoneId ?? item.report?.zone?.id);
  const players = normalizePlayers(item.players ?? item.report?.players ?? item.masterData?.actors ?? item.report?.masterData?.actors);

  return {
    id: String(item.id ?? item.reportCode ?? item.code ?? item.report?.code ?? `session-${index}`),
    reportCode: item.reportCode ?? item.code ?? item.report?.code ?? null,
    title: item.title ?? item.report?.title ?? null,
    zoneId,
    zoneName: String(zoneName),
    startTime,
    endTime,
    testData: Boolean(item.testData ?? item.report?.testData),
    fightsLoaded: Boolean(item.fightsLoaded ?? item.report?.fightsLoaded ?? item.fights ?? item.encounters ?? item.pulls ?? item.report?.fights),
    players,
    pulls,
  };
}

function normalizePulls(items, reportStartTime = null) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item, index) => {
    const rawStartTime = item.startTime ?? item.start ?? item.start_time;
    const rawEndTime = item.endTime ?? item.end ?? item.end_time;
    const startTime = toDateString(rawStartTime, reportStartTime);
    const endTime = toDateString(rawEndTime, reportStartTime);
    const startOffsetMs = normalizeOffsetMs(item.startOffsetMs ?? rawStartTime);
    const endOffsetMs = normalizeOffsetMs(item.endOffsetMs ?? rawEndTime);
    const durationSeconds = normalizeDuration(item.durationSeconds ?? item.duration ?? secondsBetween(startTime, endTime) ?? 0);
    const bossPercent = normalizeBossPercent(item.bossPercentage ?? item.bossPercent ?? item.fightPercentage);
    const fightPercent = normalizeBossPercent(item.fightPercentage ?? item.fightPercent ?? item.bossPercentage ?? item.bossPercent);
    const lastPhase = normalizePhaseNumber(item.lastPhase ?? item.phase);
    const gameZone = item.gameZone ?? item.zone ?? null;

    return {
      id: String(item.id ?? item.fightID ?? index + 1),
      encounterId: normalizeEncounterId(item.encounterID ?? item.encounterId),
      gameZoneId: normalizeId(item.gameZoneID ?? item.gameZoneId ?? gameZone?.id),
      gameZoneName: gameZone?.name ?? item.gameZoneName ?? null,
      name: item.name ?? item.encounterName ?? item.bossName ?? `Pull ${index + 1}`,
      startTime,
      startOffsetMs,
      endTime: endTime || addSeconds(startTime, durationSeconds),
      endOffsetMs,
      durationSeconds,
      bossPercent,
      fightPercent,
      lastPhase,
      lastPhaseIsIntermission: Boolean(item.lastPhaseIsIntermission),
      kill: Boolean(item.kill ?? item.isKill ?? bossPercent === 0),
      events: normalizeFightEvents(item.events ?? item.eventData ?? [], {
        fightStartTime: startTime,
        fightStartOffsetMs: startOffsetMs,
      }),
      friendlyPlayerIds: normalizeIdList(item.friendlyPlayers ?? item.friendlyPlayerIds),
    };
  });
}

export function normalizePlayers(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((actor) => actor && typeof actor === 'object')
    .map((actor) => ({
      id: Number(actor.id ?? actor.gameID ?? actor.reportID),
      name: actor.name ?? `Actor ${actor.id ?? ''}`.trim(),
      type: actor.type ?? null,
      subType: actor.subType ?? actor.subtype ?? null,
    }))
    .filter((actor) => Number.isFinite(actor.id) && actor.name);
}

function normalizeIdList(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map(Number).filter(Number.isFinite);
}

export function normalizeFightEvents(rawEvents, options = {}) {
  if (!Array.isArray(rawEvents)) {
    return [];
  }

  const fightStartMs = new Date(options.fightStartTime ?? 0).getTime();
  const fightStartOffsetMs = Number(options.fightStartOffsetMs);
  const playerLookup = options.playerLookup ?? new Map();
  const playerIds = options.playerIds?.length ? new Set(options.playerIds.map(Number)) : null;

  return rawEvents
    .filter((event) => event && typeof event === 'object')
    .filter((event) => event.kind === 'death' || event.kind === 'damageDown' || event.type === 'death' || (event.type === 'applydebuff' && Number(event.abilityGameID) === DAMAGE_DOWN_ABILITY_ID))
    .filter((event) => {
      if (!playerIds) {
        return true;
      }

      const playerId = Number(event.targetID ?? event.sourceID ?? event.playerId);
      return playerIds.has(playerId);
    })
    .map((event) => {
      const playerId = Number(event.targetID ?? event.sourceID ?? event.playerId);
      const timestamp = Number(event.timestamp ?? event.time ?? event.startTime ?? 0);
      const timing = normalizeEventTiming({
        elapsedMs: event.elapsedMs,
        fightStartMs,
        fightStartOffsetMs,
        timestamp,
        timestampMs: event.timestampMs,
      });

      return {
        elapsedMs: timing.elapsedMs,
        timestampMs: timing.timestampMs,
        kind: event.kind ?? (event.type === 'death' ? 'death' : 'damageDown'),
        playerId,
        playerName: playerLookup.get(playerId)?.name ?? event.playerName ?? event.targetName ?? event.sourceName ?? `Actor ${playerId}`,
      };
    })
    .sort((a, b) => a.elapsedMs - b.elapsedMs);
}

export function buildPlayerLookup(players) {
  return new Map((players ?? []).map((player) => [Number(player.id), player]));
}

export function getFightPlayers(players, friendlyPlayerIds) {
  if (!friendlyPlayerIds?.length) {
    return players ?? [];
  }

  const friendlyIds = new Set(friendlyPlayerIds.map(Number));
  return (players ?? []).filter((player) => friendlyIds.has(Number(player.id)));
}

function normalizeBossPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 100;
  }

  return number > 100 ? number / 100 : number;
}

function normalizePhaseNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeId(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeEncounterId(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeOffsetMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number >= REPORT_RELATIVE_TIMESTAMP_CUTOFF_MS) {
    return null;
  }

  return number;
}

function normalizeEventTiming({ elapsedMs, fightStartMs, fightStartOffsetMs, timestamp, timestampMs }) {
  const explicitTimestampMs = Number(timestampMs);
  if (Number.isFinite(explicitTimestampMs)) {
    return {
      elapsedMs: Math.max(0, explicitTimestampMs - fightStartMs),
      timestampMs: explicitTimestampMs,
    };
  }

  const explicitElapsedMs = Number(elapsedMs);
  if (Number.isFinite(explicitElapsedMs)) {
    const safeElapsedMs = Math.max(0, explicitElapsedMs);
    return {
      elapsedMs: safeElapsedMs,
      timestampMs: fightStartMs + safeElapsedMs,
    };
  }

  if (timestamp > UNIX_MILLISECONDS_CUTOFF) {
    return {
      elapsedMs: Math.max(0, timestamp - fightStartMs),
      timestampMs: timestamp,
    };
  }

  if (Number.isFinite(fightStartOffsetMs)) {
    const calculatedElapsedMs = timestamp >= fightStartOffsetMs ? timestamp - fightStartOffsetMs : timestamp;
    const safeElapsedMs = Math.max(0, calculatedElapsedMs);
    return {
      elapsedMs: safeElapsedMs,
      timestampMs: fightStartMs + safeElapsedMs,
    };
  }

  return {
    elapsedMs: Math.max(0, timestamp),
    timestampMs: fightStartMs + Math.max(0, timestamp),
  };
}

function normalizeDuration(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }

  return number > 10_000 ? Math.round(number / 1000) : number;
}

function toDateString(value, reportStartTime = null) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }

    if (reportStartTime && value < REPORT_RELATIVE_TIMESTAMP_CUTOFF_MS) {
      return addSeconds(toDateString(reportStartTime), value / 1000);
    }

    return toValidIsoString(
      value > UNIX_MILLISECONDS_CUTOFF ? value : value * 1000,
    );
  }

  return toValidIsoString(value);
}

function addSeconds(value, seconds) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const startMs = new Date(value).getTime();
  const secondsNumber = Number(seconds);

  if (!Number.isFinite(startMs) || !Number.isFinite(secondsNumber)) {
    return null;
  }

  return new Date(startMs + secondsNumber * 1000).toISOString();
}

function toValidIsoString(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function secondsBetween(startTime, endTime) {
  if (!startTime || !endTime) {
    return null;
  }

  const startMs = new Date(startTime).getTime();
  const endMs = new Date(endTime).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null;
  }

  return Math.max(0, Math.round((endMs - startMs) / 1000));
}
