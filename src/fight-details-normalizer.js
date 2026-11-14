// Converts raw FFLogs responses and embedded fixtures into display-ready per-fight state.
export function createFightDetailsNormalizer(dependencies) {
  const {
    DANCING_MAD_ENCOUNTER_NAME,
    DEATH_REASON_DAMAGE_LOOKBACK_MS,
    FIGHT_EVENT_RECAP_LOOKBACK_MS,
    FIGHT_EVENT_RECAP_MAX_ROWS,
    TANK_FORTY_PERCENT_BUFFS,
    extractPhaseReferenceEvents,
    extractPlayerActionCasts,
    extractPlayerDebuffEvents,
    extractPlayerLifeEvents,
    extractPlayerSpeedAttributes,
    extractPlayerSpeedStatusEvents,
    extractTargetabilityEvents,
    extractTrackedMitigationCasts,
    findCauseOfDeath,
    getDancingMadPhase,
    getEventAbilityName,
    getFiniteNumber,
    getFflogsAbilityIconUrl,
    inferTankPlanSlots,
    isDisplayedFightEvent,
    normalizeEventType,
    normalizePartyMembers,
    resolveEncounterPhaseStarts,
  } = dependencies;

  function normalizeFightDetails(
    rawDetails,
    fightId = rawDetails?.fights?.[0]?.id,
    { playerActionsOnly = false } = {},
  ) {
    const actors = rawDetails?.masterData?.actors ?? [];
    const actorNames = new Map(actors.map((actor) => [Number(actor.id), actor.name]));
    const abilityNames = new Map((rawDetails?.masterData?.abilities ?? [])
      .map((ability) => [Number(ability.gameID), ability.name]));
    const abilityIcons = new Map((rawDetails?.masterData?.abilities ?? [])
      .filter((ability) => ability.icon)
      .map((ability) => [Number(ability.gameID), ability.icon]));
    const rawFight = (rawDetails?.fights ?? []).find((fight) => Number(fight.id) === Number(fightId))
      ?? rawDetails?.fights?.[0];
    const friendlyPlayers = rawFight?.friendlyPlayers ?? [];
    const friendlyIds = new Set(friendlyPlayers.map(Number));
    const rawFightId = Number(rawFight?.id);
    const returnedFightIds = new Set((rawDetails?.fights ?? []).map((fight) => Number(fight.id)));
    const fightStart = Number(rawFight?.startTime);
    const fightEnd = Number(rawFight?.endTime);
    const rawEvents = (rawDetails?.events?.data ?? []).filter((event) => {
      const eventFightId = Number(event.fight);
      if (Number.isFinite(rawFightId) && returnedFightIds.has(eventFightId)) {
        return eventFightId === rawFightId;
      }
      if (!Number.isFinite(fightStart) || !Number.isFinite(fightEnd)) return true;
      const timestamp = Number(event.timestamp);
      return timestamp >= fightStart && timestamp <= fightEnd;
    });
    const phaseReferenceEvents = extractPhaseReferenceEvents(rawEvents, actorNames);
    const partyMembers = normalizePartyMembers(actors, friendlyIds);
    const actionCasts = extractPlayerActionCasts(
      rawEvents, actorNames, friendlyIds, abilityNames, abilityIcons,
    );
    const playerSpeedAttributes = extractPlayerSpeedAttributes(rawEvents, actorNames);
    const playerSpeedStatusEvents = extractPlayerSpeedStatusEvents(rawEvents, actorNames);
    const targetabilityEvents = extractTargetabilityEvents(rawEvents, friendlyIds);
    if (playerActionsOnly) {
      const playerDebuffEvents = extractPlayerDebuffEvents(
        rawEvents, actorNames, friendlyIds, abilityNames,
      );
      const lifeEvents = extractPlayerLifeEvents(rawEvents);
      return {
        status: 'ready',
        detailLevel: 'player-actions',
        phaseReferenceEvents,
        partyMembers,
        actionCasts,
        playerSpeedAttributes,
        playerSpeedStatusEvents,
        playerDebuffEvents,
        lifeEvents,
        targetabilityEvents,
      };
    }
    const tankSlots = inferTankPlanSlots(rawEvents, partyMembers);
    const mitigationCasts = extractTrackedMitigationCasts(rawEvents, actorNames);
    const playerDebuffEvents = extractPlayerDebuffEvents(
      rawEvents, actorNames, friendlyIds, abilityNames,
    );
    const lifeEvents = extractPlayerLifeEvents(rawEvents);
    const phaseStarts = resolveEncounterPhaseStarts(DANCING_MAD_ENCOUNTER_NAME, rawFight, phaseReferenceEvents);
    const events = extractDisplayedFightEvents(
      rawEvents,
      actorNames,
      friendlyIds,
      abilityNames,
      abilityIcons,
      partyMembers,
      rawFight,
      phaseStarts,
    );
    return {
      status: 'ready', events, phaseReferenceEvents, partyMembers, tankSlots,
      mitigationCasts, actionCasts, playerSpeedAttributes, playerSpeedStatusEvents,
      playerDebuffEvents, lifeEvents, targetabilityEvents,
    };
  }
  
  function normalizeEmbeddedFightDetails(report, fight) {
    if (fight.cachedDetails?.cacheFormat === 'raw-events-v1' && fight.cachedDetails.rawDetails) {
      return normalizeFightDetails(fight.cachedDetails.rawDetails, fight.id);
    }
    if (fight.cachedDetails?.status === 'ready') return fight.cachedDetails;
    const actorNames = new Map((report.testActors ?? []).map((actor) => [Number(actor.id), actor.name]));
    const friendlyIds = new Set((fight.friendlyPlayers ?? []).map(Number));
    const phaseReferenceEvents = extractPhaseReferenceEvents(fight.events ?? [], actorNames);
    const partyMembers = normalizePartyMembers(report.testActors ?? [], friendlyIds);
    const tankSlots = inferTankPlanSlots(fight.events ?? [], partyMembers);
    const mitigationCasts = extractTrackedMitigationCasts(fight.events ?? [], actorNames);
    const actionCasts = extractPlayerActionCasts(
      fight.events ?? [], actorNames, friendlyIds, new Map(), new Map(),
    );
    const playerSpeedAttributes = extractPlayerSpeedAttributes(fight.events ?? [], actorNames);
    const playerSpeedStatusEvents = extractPlayerSpeedStatusEvents(fight.events ?? [], actorNames);
    const targetabilityEvents = extractTargetabilityEvents(fight.events ?? [], friendlyIds);
    const playerDebuffEvents = extractPlayerDebuffEvents(
      fight.events ?? [], actorNames, friendlyIds, new Map(),
    );
    const lifeEvents = extractPlayerLifeEvents(fight.events ?? []);
    const phaseStarts = resolveEncounterPhaseStarts(DANCING_MAD_ENCOUNTER_NAME, fight, phaseReferenceEvents);
    const events = extractDisplayedFightEvents(
      fight.events ?? [],
      actorNames,
      friendlyIds,
      new Map(),
      new Map(),
      partyMembers,
      fight,
      phaseStarts,
    );
    return {
      status: 'ready', events, phaseReferenceEvents, partyMembers, tankSlots,
      mitigationCasts, actionCasts, playerSpeedAttributes, playerSpeedStatusEvents,
      playerDebuffEvents, lifeEvents, targetabilityEvents,
    };
  }
  
  // Resolve display events and their causes together. DDs and deaths use the latest
  // incoming damage ability for that player; a DD falls back to its applying ability.
  function extractDisplayedFightEvents(
    rawEvents,
    actorNames,
    friendlyIds,
    abilityNames = new Map(),
    abilityIcons = new Map(),
    partyMembers = [],
    fight = null,
    phaseStarts = new Map(),
  ) {
    const events = rawEvents
      .filter(isDisplayedFightEvent)
      .filter((event) => friendlyIds.size === 0 || friendlyIds.has(Number(event.targetID)))
      .map((event) => {
        const causalDamage = findLastDamageEvent(
          rawEvents,
          event,
          event.type === 'death' ? DEATH_REASON_DAMAGE_LOOKBACK_MS : Number.POSITIVE_INFINITY,
        );
        const snapshotEvent = causalDamage ?? event;
        const snapshotTimestamp = Number(snapshotEvent.timestamp);
        const snapshotEventIndex = rawEvents.indexOf(snapshotEvent);
        const casterId = Number(
          causalDamage?.sourceID
            ?? causalDamage?.sourceId
            ?? event.sourceID
            ?? event.sourceId,
        );
        const playerId = Number(event.targetID ?? event.targetId);
        return {
          kind: event.type === 'death' ? 'Death' : 'Damage down',
          player: actorNames.get(playerId) ?? event.targetName ?? `Actor ${event.targetID}`,
          casterDebuffs: getActiveDebuffs(
            rawEvents,
            casterId,
            snapshotTimestamp,
            snapshotEventIndex,
            abilityNames,
            abilityIcons,
          ),
          playerDebuffs: getActiveDebuffs(
            rawEvents,
            playerId,
            snapshotTimestamp,
            snapshotEventIndex,
            abilityNames,
            abilityIcons,
          ),
          playerBuffs: getActiveStatuses(
            rawEvents,
            playerId,
            snapshotTimestamp,
            snapshotEventIndex,
            abilityNames,
            abilityIcons,
            'buff',
          ),
          reason: event.type === 'death'
            ? getDeathReason(rawEvents, event, abilityNames, partyMembers, fight, phaseStarts)
            : getEventAbilityName(causalDamage, abilityNames)
              ?? getEventAbilityName(event, abilityNames),
          recapEvents: extractFightEventRecap(
            rawEvents,
            playerId,
            Number(event.timestamp),
            actorNames,
            abilityNames,
            abilityIcons,
          ),
          timestamp: Number(event.timestamp),
        };
      });
    return events;
  }
  
  function extractFightEventRecap(
    rawEvents,
    targetId,
    anchorTimestamp,
    actorNames,
    abilityNames,
    abilityIcons,
  ) {
    if (!Number.isFinite(targetId) || !Number.isFinite(anchorTimestamp)) return [];
    return rawEvents
      .map((event, eventIndex) => ({ event, eventIndex }))
      .filter(({ event }) => {
        const eventType = normalizeEventType(event.type ?? event.eventType);
        const timestamp = Number(event.timestamp);
        return ['damage', 'heal'].includes(eventType)
          && Number(event.targetID ?? event.targetId) === targetId
          && timestamp <= anchorTimestamp
          && timestamp >= anchorTimestamp - FIGHT_EVENT_RECAP_LOOKBACK_MS;
      })
      .slice(-FIGHT_EVENT_RECAP_MAX_ROWS)
      .reverse()
      .map(({ event, eventIndex }) => {
        const eventType = normalizeEventType(event.type ?? event.eventType);
        const timestamp = Number(event.timestamp);
        const sourceId = Number(event.sourceID ?? event.sourceId);
        const abilityId = Number(event.abilityGameID ?? event.abilityId ?? event.ability?.id);
        const amount = Math.max(0, Number(event.amount) || 0);
        // Damage amounts include overkill, while heal amounts are already the
        // effective healing (overheal is reported in a separate field).
        const overkill = Math.max(0, Number(event.overkill) || 0);
        const overheal = Math.max(0, Number(event.overheal) || 0);
        const effectiveAmount = eventType === 'damage'
          ? Math.max(0, amount - overkill)
          : amount;
        const hitPointsAfter = getFiniteNumber(
          event.targetResources?.hitPoints,
          event.targetResources?.currentHitPoints,
          event.targetResources?.currentHP,
        );
        const maxHitPoints = getFiniteNumber(
          event.targetResources?.maxHitPoints,
          event.targetResources?.maxHP,
        );
        const unclampedHitPointsBefore = Number.isFinite(hitPointsAfter)
          ? hitPointsAfter + (eventType === 'damage' ? effectiveAmount : -effectiveAmount)
          : Number.NaN;
        const hitPointsBefore = Number.isFinite(unclampedHitPointsBefore)
          ? Math.max(0, Number.isFinite(maxHitPoints)
            ? Math.min(maxHitPoints, unclampedHitPointsBefore)
            : unclampedHitPointsBefore)
          : Number.NaN;
        const ability = getEventAbilityName(event, abilityNames) ?? (eventType === 'heal' ? 'Healing' : 'Damage');
        return {
          eventType,
          relativeMs: timestamp - anchorTimestamp,
          amount,
          effectiveAmount,
          overkill,
          overheal,
          ability,
          icon: getFflogsAbilityIconUrl(event.ability?.icon ?? abilityIcons.get(abilityId), ability),
          source: actorNames.get(sourceId)
            ?? event.source?.name
            ?? event.sourceName
            ?? (Number.isFinite(sourceId) ? `Actor ${sourceId}` : 'Environment'),
          hitPointsBefore,
          hitPointsAfter,
          maxHitPoints,
          shieldAmount: getActiveShieldAmount(rawEvents, targetId, timestamp, eventIndex),
          casterDebuffs: getActiveDebuffs(
            rawEvents, sourceId, timestamp, eventIndex, abilityNames, abilityIcons,
          ),
          playerDebuffs: getActiveDebuffs(
            rawEvents, targetId, timestamp, eventIndex, abilityNames, abilityIcons,
          ),
          playerBuffs: getActiveStatuses(
            rawEvents, targetId, timestamp, eventIndex, abilityNames, abilityIcons, 'buff',
          ),
        };
      });
  }
  
  // FFLogs reports shield strength on apply/refresh events and shield consumption
  // as separate absorbed events. Replay those transitions through this snapshot so
  // the recap can show the target's remaining shields after each hit or heal.
  function getActiveShieldAmount(rawEvents, targetId, timestamp, eventIndex) {
    if (!Number.isFinite(targetId) || !Number.isFinite(timestamp)) return 0;
    const activeShields = new Map();
    const eventsThroughSnapshot = eventIndex >= 0
      ? rawEvents.slice(0, eventIndex + 1)
      : rawEvents.filter((event) => Number(event.timestamp) <= timestamp);
    for (const event of eventsThroughSnapshot) {
      if (Number(event.targetID ?? event.targetId) !== targetId) continue;
      const type = normalizeEventType(event.type ?? event.eventType);
      if (!['applybuff', 'refreshbuff', 'removebuff', 'absorbed'].includes(type)) continue;
      const abilityId = Number(
        event.abilityGameID
          ?? event.abilityGameId
          ?? event.ability?.gameID
          ?? event.ability?.id,
      );
      if (!Number.isFinite(abilityId)) continue;
      if (type === 'removebuff') {
        activeShields.delete(abilityId);
        continue;
      }
      if (type === 'absorbed') {
        const remaining = Math.max(0, (activeShields.get(abilityId) ?? 0) - (Number(event.amount) || 0));
        if (remaining > 0) activeShields.set(abilityId, remaining);
        else activeShields.delete(abilityId);
        continue;
      }
      const absorb = Math.max(0, Number(event.absorb) || 0);
      if (absorb > 0) activeShields.set(abilityId, absorb);
    }
    return [...activeShields.values()].reduce((total, amount) => total + amount, 0);
  }
  
  // Reconstruct one actor's debuffs at an event timestamp from the ordered status
  // transitions FFLogs returns. This works for both enemy casters and party members.
  function getActiveDebuffs(rawEvents, targetId, timestamp, eventIndex, abilityNames, abilityIcons) {
    return getActiveStatuses(
      rawEvents,
      targetId,
      timestamp,
      eventIndex,
      abilityNames,
      abilityIcons,
      'debuff',
    );
  }
  
  // Rebuild either buff or debuff state from FFLogs lifecycle events. Keeping this
  // in one path ensures the three status columns use the same timestamp semantics.
  function getActiveStatuses(
    rawEvents,
    targetId,
    timestamp,
    eventIndex,
    abilityNames,
    abilityIcons,
    statusKind,
  ) {
    if (!Number.isFinite(targetId) || !Number.isFinite(timestamp)) return [];
    const activeStatuses = new Map();
    const eventTypes = statusKind === 'buff'
      ? new Set(['applybuff', 'refreshbuff', 'removebuff'])
      : new Set(['applydebuff', 'refreshdebuff', 'removedebuff']);
    // Death cleanup and the killing hit often share a timestamp. Cutting the raw
    // stream at the hit preserves same-millisecond applications before the hit,
    // while excluding removal events that FFLogs lists immediately after it.
    const eventsBeforeSnapshot = eventIndex >= 0
      ? rawEvents.slice(0, eventIndex)
      : rawEvents.filter((event) => Number(event.timestamp) < timestamp);
    const statusEvents = eventsBeforeSnapshot
      .filter((event) => Number(event.targetID ?? event.targetId) === targetId)
      .sort((first, second) => Number(first.timestamp) - Number(second.timestamp));
    for (const event of statusEvents) {
      const type = String(event.type ?? event.eventType ?? '').replace(/\s+/g, '').toLowerCase();
      if (!eventTypes.has(type)) continue;
      const abilityId = Number(event.abilityGameID ?? event.abilityGameId ?? event.ability?.gameID);
      const name = getEventAbilityName(event, abilityNames);
      if (!name) continue;
      const key = Number.isFinite(abilityId) ? abilityId : name;
      if (type === `remove${statusKind}`) {
        activeStatuses.delete(key);
      } else {
        activeStatuses.set(key, {
          name,
          icon: getFflogsAbilityIconUrl(
            event.ability?.icon ?? abilityIcons.get(abilityId),
            name,
          ),
        });
      }
    }
    return [...activeStatuses.values()].sort((first, second) => first.name.localeCompare(second.name));
  }
  
  // FFLogs includes a dedicated killing blow on ordinary deaths. Environmental
  // deaths instead use the Environment source and should not inherit an old hit.
  function getDeathReason(rawEvents, deathEvent, abilityNames, partyMembers, fight, phaseStarts) {
    const killingDamage = findLastDamageEvent(rawEvents, deathEvent, DEATH_REASON_DAMAGE_LOOKBACK_MS);
    const programmedCause = getProgrammedDeathReason(
      rawEvents,
      deathEvent,
      killingDamage,
      abilityNames,
      partyMembers,
      fight,
      phaseStarts,
    );
    if (programmedCause) return programmedCause;
  
    const killingAbility = deathEvent.killingAbility?.name ?? deathEvent.killingAbilityName;
    if (killingAbility) return String(killingAbility);
    const killingAbilityId = Number(deathEvent.killingAbilityGameID ?? deathEvent.killingAbilityId);
    if (Number.isFinite(killingAbilityId) && killingAbilityId > 0) {
      return abilityNames.get(killingAbilityId) ?? `Ability ${killingAbilityId}`;
    }
    if (Number(deathEvent.sourceID ?? deathEvent.sourceId) === -1) {
      return 'Unknown';
    }
    // A hit further back than this is too weakly connected to the death to present
    // as its cause; environmental deaths commonly have no nearby damage event.
    return findLastDamageAbility(rawEvents, deathEvent, abilityNames, DEATH_REASON_DAMAGE_LOOKBACK_MS);
  }
  
  function findLastDamageAbility(rawEvents, targetEvent, abilityNames, maxAgeMs = Number.POSITIVE_INFINITY) {
    return getEventAbilityName(findLastDamageEvent(rawEvents, targetEvent, maxAgeMs), abilityNames);
  }
  
  function findLastDamageEvent(rawEvents, targetEvent, maxAgeMs = Number.POSITIVE_INFINITY) {
    const targetId = Number(targetEvent.targetID ?? targetEvent.targetId);
    const targetTimestamp = Number(targetEvent.timestamp);
    let latestDamage = null;
    for (const event of rawEvents) {
      const eventType = String(event.type ?? event.eventType ?? '').replace(/\s+/g, '').toLowerCase();
      const timestamp = Number(event.timestamp);
      if (eventType !== 'damage'
        || Number(event.targetID ?? event.targetId) !== targetId
        || !Number.isFinite(timestamp)
        || timestamp > targetTimestamp
        || targetTimestamp - timestamp > maxAgeMs
        || (latestDamage && timestamp < Number(latestDamage.timestamp))) {
        continue;
      }
      latestDamage = event;
    }
    return latestDamage;
  }
  
  // Assemble the complete fight-specific context only for deaths. The separate
  // resolver owns the chronological decision tree; this adapter owns FFLogs shapes.
  function getProgrammedDeathReason(
    rawEvents,
    deathEvent,
    killingDamage,
    abilityNames,
    partyMembers,
    fight,
    phaseStarts,
  ) {
    const fightStart = Number(fight?.startTime);
    const timestamp = Number(deathEvent.timestamp);
    if (!Number.isFinite(fightStart) || !Number.isFinite(timestamp)) return null;
  
    const elapsedMs = timestamp - fightStart;
    const phase = getDancingMadPhase(elapsedMs, phaseStarts);
    const phaseStartMs = phaseStarts.get(phase);
    if (!Number.isFinite(phaseStartMs)) return null;
  
    const targetId = Number(deathEvent.targetID ?? deathEvent.targetId);
    const victim = partyMembers.find((member) => member.id === targetId);
    const activeBuffs = getActiveBuffNames(rawEvents, targetId, timestamp, abilityNames);
    return findCauseOfDeath({
      phase,
      time: (elapsedMs - phaseStartMs) / 1000,
      isTank: victim?.role === 'Tank',
      killingAbility: getEventAbilityName(killingDamage, abilityNames),
      overkill: killingDamage?.overkill,
      activeBuffs,
      hasFortyPercentMitigation: [...TANK_FORTY_PERCENT_BUFFS].some((name) => activeBuffs.has(name)),
    });
  }
  
  function getActiveBuffNames(rawEvents, targetId, timestamp, abilityNames) {
    const activeBuffs = new Set();
    const buffEvents = rawEvents
      .filter((event) => Number(event.targetID ?? event.targetId) === targetId
        && Number(event.timestamp) <= timestamp)
      .sort((first, second) => Number(first.timestamp) - Number(second.timestamp));
  
    for (const event of buffEvents) {
      const type = normalizeEventType(event.eventType ?? event.type);
      if (!['applybuff', 'refreshbuff', 'removebuff'].includes(type)) continue;
      const ability = getEventAbilityName(event, abilityNames);
      if (!ability) continue;
      if (type === 'removebuff') activeBuffs.delete(ability);
      else activeBuffs.add(ability);
    }
    return activeBuffs;
  }
  
  

  return { normalizeEmbeddedFightDetails, normalizeFightDetails };
}
