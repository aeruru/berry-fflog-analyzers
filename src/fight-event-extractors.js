// Extracts normalized party, combat, status, cast, and targetability events from FFLogs data.
export function createFightEventExtractors({
  getEncounterEventReferences,
  getEventAbilityName,
  getFflogsAbilityIconUrl,
  getMitigationAbility,
  getTrackedMitigations,
  isPlayerActionSpeedStatus,
  jobAbbreviations,
  jobRoles,
  normalizeEventType,
  encounterName,
}) {
  function extractPlayerLifeEvents(events) {
    return events
      .filter((event) => ['death', 'resurrect'].includes(String(event.type ?? event.eventType ?? '').toLowerCase()))
      .map((event) => ({
        type: String(event.type ?? event.eventType).toLowerCase(),
        playerId: Number(event.targetID ?? event.targetId),
        timestamp: Number(event.timestamp),
      }))
      .filter((event) => Number.isFinite(event.playerId) && Number.isFinite(event.timestamp))
      .sort((first, second) => first.timestamp - second.timestamp);
  }

  function extractTargetabilityEvents(events, friendlyIds = new Set()) {
    return events
      .filter((event) => normalizeEventType(event.type ?? event.eventType) === 'targetabilityupdate')
      .map((event) => ({
        actorId: Number(event.sourceID ?? event.sourceId ?? event.actorID ?? event.actorId
          ?? event.targetID ?? event.targetId),
        isTargetable: event.isTargetable ?? event.targetable,
        timestamp: Number(event.timestamp),
      }))
      .filter((event) => Number.isFinite(event.actorId)
        && !friendlyIds.has(event.actorId)
        && typeof event.isTargetable === 'boolean'
        && Number.isFinite(event.timestamp))
      .sort((first, second) => first.timestamp - second.timestamp);
  }

  function normalizeJobAbbreviation(job) {
    const compactJob = String(job ?? '').replace(/\s+/g, '');
    return jobAbbreviations.get(compactJob) ?? compactJob.toUpperCase();
  }

  function normalizePartyMembers(actors, friendlyIds) {
    return actors
      .filter((actor) => actor.type === 'Player'
        && (friendlyIds.size === 0 || friendlyIds.has(Number(actor.id))))
      .map((actor) => {
        const job = normalizeJobAbbreviation(actor.subType ?? actor.job);
        return { id: Number(actor.id), name: actor.name, job, role: jobRoles.get(job) ?? null };
      });
  }

  function extractTrackedMitigationCasts(events, actorNames) {
    const trackedAbilityIds = new Set(getTrackedMitigations().map((entry) => Number(entry.abilityId)));
    return events
      .filter((event) => normalizeEventType(event.eventType ?? event.type) === 'cast')
      .filter((event) => trackedAbilityIds.has(Number(event.abilityId ?? event.abilityGameID ?? event.ability?.id)))
      .map((event) => ({
        abilityId: Number(event.abilityId ?? event.abilityGameID ?? event.ability?.id),
        sourceId: Number(event.sourceID ?? event.sourceId),
        source: event.source ?? event.sourceName ?? actorNames.get(Number(event.sourceID ?? event.sourceId)),
        timestamp: Number(event.timestamp),
      }))
      .filter((event) => Number.isFinite(event.timestamp));
  }

  function extractPlayerSpeedAttributes(events, actorNames) {
    return events
      .filter((event) => normalizeEventType(event.eventType ?? event.type) === 'combatantinfo')
      .map((event) => ({
        sourceId: Number(event.sourceID ?? event.sourceId),
        source: event.source ?? event.sourceName ?? actorNames.get(Number(event.sourceID ?? event.sourceId)),
        skillSpeed: Number(event.skillSpeed),
        spellSpeed: Number(event.spellSpeed),
      }))
      .filter((entry) => entry.source
        && (Number.isFinite(entry.skillSpeed) || Number.isFinite(entry.spellSpeed)));
  }

  function extractPlayerSpeedStatusEvents(events, actorNames) {
    return events.map((event) => {
      const eventType = normalizeEventType(event.eventType ?? event.type);
      const statusId = Number(event.abilityId ?? event.abilityGameID ?? event.ability?.id);
      const targetId = Number(event.targetID ?? event.targetId);
      return {
        eventType,
        statusId,
        targetId,
        target: event.target ?? event.targetName ?? actorNames.get(targetId),
        timestamp: Number(event.timestamp),
      };
    }).filter((event) => ['applybuff', 'refreshbuff', 'removebuff'].includes(event.eventType)
      && isPlayerActionSpeedStatus(event.statusId)
      && event.target
      && Number.isFinite(event.timestamp))
      .sort((first, second) => first.timestamp - second.timestamp);
  }

  function extractPlayerDebuffEvents(events, actorNames, friendlyIds, abilityNames) {
    const supportedEventTypes = new Set(['applydebuff', 'refreshdebuff', 'removedebuff']);
    return events.map((event) => {
      const eventType = normalizeEventType(event.eventType ?? event.type);
      const sourceId = Number(event.sourceID ?? event.sourceId);
      const targetId = Number(event.targetID ?? event.targetId);
      return {
        eventType,
        abilityId: Number(event.abilityId ?? event.abilityGameID ?? event.ability?.id),
        ability: getEventAbilityName(event, abilityNames),
        sourceId,
        source: event.source ?? event.sourceName ?? actorNames.get(sourceId),
        targetId,
        timestamp: Number(event.timestamp),
      };
    }).filter((event) => supportedEventTypes.has(event.eventType)
      && (friendlyIds.size === 0 || friendlyIds.has(event.sourceId))
      && !friendlyIds.has(event.targetId)
      && event.source
      && event.ability
      && Number.isFinite(event.timestamp))
      .sort((first, second) => first.timestamp - second.timestamp);
  }

  function extractPlayerActionCasts(events, actorNames, friendlyIds, abilityNames, abilityIcons) {
    const supportedEventTypes = new Set([
      'begincast', 'cast', 'cancelcast', 'castcancel', 'cancelledcast', 'castcancelled',
    ]);
    return events
      .filter((event) => supportedEventTypes.has(normalizeEventType(event.eventType ?? event.type)))
      .filter((event) => friendlyIds.size === 0 || friendlyIds.has(Number(event.sourceID ?? event.sourceId)))
      .map((event) => {
        const abilityId = Number(event.abilityId ?? event.abilityGameID ?? event.ability?.id);
        const ability = getEventAbilityName(event, abilityNames)
          ?? getMitigationAbility(abilityId)?.name
          ?? `Ability ${Number.isFinite(abilityId) ? abilityId : '?'}`;
        return {
          eventType: normalizeEventType(event.eventType ?? event.type),
          abilityId,
          ability,
          icon: getFflogsAbilityIconUrl(event.ability?.icon ?? event.icon ?? abilityIcons.get(abilityId), ability),
          category: event.actionCategory,
          sourceId: Number(event.sourceID ?? event.sourceId),
          source: event.source ?? event.sourceName ?? actorNames.get(Number(event.sourceID ?? event.sourceId)),
          timestamp: Number(event.timestamp),
          duration: Number(event.duration),
        };
      })
      .filter((event) => event.source && Number.isFinite(event.timestamp))
      .sort((first, second) => first.timestamp - second.timestamp);
  }

  function isDisplayedFightEvent(event) {
    return event.type === 'death'
      || (event.type === 'applydebuff' && Number(event.abilityGameID) === 1002911);
  }

  function extractPhaseReferenceEvents(events, actorNames) {
    const references = getEncounterEventReferences(encounterName);
    const referenceTypes = new Set(references.map((reference) => normalizeEventType(reference.eventType)));
    return events.map((event) => {
      const eventType = normalizeEventType(event.eventType ?? event.type);
      const source = event.source ?? event.sourceName ?? actorNames.get(Number(event.sourceID ?? event.sourceId));
      let ability = event.ability?.name ?? event.abilityName ?? event.ability;
      if (ability === undefined) {
        const candidates = references.filter((reference) => normalizeEventType(reference.eventType) === eventType
          && (!reference.source || reference.source === source));
        if (candidates.length === 1) ability = candidates[0].ability;
      }
      return { eventType, ability, source, timestamp: Number(event.timestamp) };
    }).filter((event) => referenceTypes.has(event.eventType) && Number.isFinite(event.timestamp));
  }

  return {
    extractPhaseReferenceEvents,
    extractPlayerActionCasts,
    extractPlayerDebuffEvents,
    extractPlayerLifeEvents,
    extractPlayerSpeedAttributes,
    extractPlayerSpeedStatusEvents,
    extractTargetabilityEvents,
    extractTrackedMitigationCasts,
    isDisplayedFightEvent,
    normalizeJobAbbreviation,
    normalizePartyMembers,
  };
}
