// Resolves encounter phases, mechanic labels, and phase-relative event timestamps.
export function createEncounterTiming({ getDefinitions, getMechanics }) {
  function getEncounterEventReferences(encounterName) {
    return (getDefinitions().get(encounterName)?.phases ?? [])
      .filter((definition) => definition.start?.type === 'event')
      .map((definition) => definition.start.event)
      .filter(Boolean);
  }

  function normalizeEventType(eventType) {
    return String(eventType ?? '').replace(/\s+/g, '').toLowerCase();
  }

  function resolveEncounterPhaseStarts(encounterName, fight, phaseReferenceEvents) {
    const definitions = getDefinitions().get(encounterName)?.phases ?? [];
    const phaseStarts = new Map();
    const pullStartTimestamp = Number(fight.startTime);

    for (const definition of [...definitions]
      .sort((first, second) => Number(first.phase) - Number(second.phase))) {
      const phase = Number(definition.phase);
      const start = definition.start ?? {};
      const relativePhase = Number(start.relativeToPhase);
      const relativeStartMs = relativePhase > 0 ? phaseStarts.get(relativePhase) : 0;
      if (relativePhase > 0 && !Number.isFinite(relativeStartMs)) continue;

      if (start.type === 'fixed') {
        const offsetMs = Number(start.seconds) * 1000;
        if (Number.isFinite(offsetMs)) phaseStarts.set(phase, relativeStartMs + offsetMs);
        continue;
      }

      if (start.type !== 'event' || !Number.isFinite(pullStartTimestamp)) continue;
      const reference = start.event ?? {};
      const minimumPullMs = Number(reference.minimumPullSeconds ?? 0) * 1000;
      const minimumRelativeMs = Number(reference.relativeToPhase) > 0
        ? phaseStarts.get(Number(reference.relativeToPhase))
        : 0;
      if (!Number.isFinite(minimumRelativeMs)) continue;
      const matchingElapsedTimes = phaseReferenceEvents
        .filter((event) => event.eventType === normalizeEventType(reference.eventType)
          && event.ability === reference.ability
          && event.source === reference.source)
        .map((event) => Number(event.timestamp) - pullStartTimestamp)
        .filter((elapsedMs) => Number.isFinite(elapsedMs)
          && elapsedMs >= minimumPullMs
          && elapsedMs >= minimumRelativeMs);
      if (matchingElapsedTimes.length > 0) {
        phaseStarts.set(phase, Math.min(...matchingElapsedTimes));
      }
    }

    return phaseStarts;
  }

  function getDancingMadPhase(elapsedMs, phaseStarts) {
    let phase = 1;
    for (const [candidatePhase, startMs] of phaseStarts) {
      if (startMs > elapsedMs) break;
      phase = candidatePhase;
    }
    return phase;
  }

  function resolveEncounterTransitionDowntime(encounterName, phaseStarts, fightEndMs) {
    const definitions = getDefinitions().get(encounterName)?.phases ?? [];
    const windows = [];
    for (const definition of definitions) {
      const phase = Number(definition.phase);
      const phaseStartMs = phaseStarts.get(phase);
      const targetableEndSeconds = Number(definition.targetableEndSeconds);
      if (!Number.isFinite(phaseStartMs) || !Number.isFinite(targetableEndSeconds)) continue;
      const nextPhaseStartMs = phaseStarts.get(phase + 1);
      const endMs = Number.isFinite(nextPhaseStartMs) ? nextPhaseStartMs : fightEndMs;
      const startMs = phaseStartMs + targetableEndSeconds * 1000;
      if (Number.isFinite(endMs) && endMs > startMs) windows.push([startMs, endMs]);
    }
    return windows;
  }

  function getEncounterRelativeTimestamp(entry, phaseStarts) {
    const phaseStartMs = phaseStarts.get(Number(entry.phase));
    const relativeMs = Number(entry.elapsedSeconds) * 1000;
    return Number.isFinite(phaseStartMs) && Number.isFinite(relativeMs)
      ? phaseStartMs + relativeMs
      : Number.POSITIVE_INFINITY;
  }

  function getDancingMadMechanic(elapsedMs, phaseStarts, phase = null) {
    let latestMechanic = null;
    for (const mechanic of getMechanics()) {
      if (phase !== null && Number(mechanic.phase) !== phase) continue;
      if (getEncounterRelativeTimestamp(mechanic, phaseStarts) >= elapsedMs) continue;
      if (!latestMechanic
        || getEncounterRelativeTimestamp(mechanic, phaseStarts)
          > getEncounterRelativeTimestamp(latestMechanic, phaseStarts)) {
        latestMechanic = mechanic;
      }
    }
    return latestMechanic;
  }

  return {
    getDancingMadMechanic,
    getDancingMadPhase,
    getEncounterEventReferences,
    getEncounterRelativeTimestamp,
    normalizeEventType,
    resolveEncounterPhaseStarts,
    resolveEncounterTransitionDowntime,
  };
}
