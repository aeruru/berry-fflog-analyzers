import {
  FIGHT_EVENTS_QUERY,
  FIGHT_EVENT_FILTER,
} from './config.js';
import { cachedFflogsGraphql } from './fflogs.js';
import {
  buildPlayerLookup,
  getFightPlayers,
  normalizeFightEvents,
  normalizePlayers,
} from './normalize.js';

export async function fetchFightEventDetails(report, fight, { endpoint, onExpired }) {
  if (!report.reportCode) {
    throw new Error('report code unavailable');
  }

  const result = await cachedFflogsGraphql('FightEvents', endpoint, FIGHT_EVENTS_QUERY, {
    code: report.reportCode,
    fightIDs: [Number(fight.id)],
    filterExpression: FIGHT_EVENT_FILTER,
  }, { onExpired });
  const rawReport = result?.data?.reportData?.report;
  const actors = normalizePlayers(rawReport?.masterData?.actors ?? []);
  const fightInfo = rawReport?.fights?.[0] ?? {};
  const eventRows = rawReport?.events?.data ?? [];
  const playerLookup = buildPlayerLookup(actors);
  const players = getFightPlayers(actors, fightInfo.friendlyPlayers);
  const playerIds = players.map((player) => player.id);

  return {
    players,
    events: normalizeFightEvents(eventRows, {
      fightStartTime: fight.startTime,
      fightStartOffsetMs: fight.startOffsetMs,
      playerLookup,
      playerIds,
    }),
  };
}

export function getEmbeddedFightEventDetails(report, fight) {
  const playerLookup = buildPlayerLookup(report.players);
  const players = getFightPlayers(report.players, fight.friendlyPlayerIds);
  const playerIds = players.map((player) => player.id);

  return {
    players,
    events: normalizeFightEvents(fight.events, {
      fightStartTime: fight.startTime,
      fightStartOffsetMs: fight.startOffsetMs,
      playerLookup,
      playerIds,
    }),
  };
}

export function getFightEventKey(report, fight) {
  return `${report.id}:${fight.id}`;
}
