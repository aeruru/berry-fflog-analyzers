// Enriches deterministic fixture reports with paginated actions and mitigation casts for testing.
export function createTestReportData(dependencies) {
  const {
    DANCING_MAD_ENCOUNTER_NAME,
    collectFflogsEventPages,
    extractPhaseReferenceEvents,
    getDancingMadMitigations,
    getFightDuration,
    getMitigationJobs,
    isDmuPull,
    mapPartyMembersToPlanSlots,
    normalizeJobAbbreviation,
    normalizePartyMembers,
    resolveEncounterPhaseStarts,
  } = dependencies;

  function addTestMitigationCasts(report, actors, reportIndex) {
    const friendlyPlayers = actors.filter((actor) => actor.type === 'Player').map((actor) => Number(actor.id));
    const actorNames = new Map(actors.map((actor) => [Number(actor.id), actor.name]));
    const playerByJob = new Map(actors
      .filter((actor) => actor.type === 'Player')
      .map((actor) => [normalizeJobAbbreviation(actor.subType ?? actor.job), actor]));
    const trackedAbilityIds = new Set(getDancingMadMitigations().map((entry) => Number(entry.abilityId)));
  
    if (report.preserveTestDetails) return report;
  
    if (report.preserveTestEvents) {
      return {
        ...report,
        fights: report.fights.map((fight) => ({
          ...fight,
          friendlyPlayers: fight.friendlyPlayers?.length ? fight.friendlyPlayers : friendlyPlayers,
          events: addTestPlayerActionCasts(fight, actors, fight.events ?? []),
        })),
        testActors: actors,
      };
    }
  
    const fights = report.fights.map((fight) => {
      if (!isDmuPull(fight)) return fight;
      const durationMs = getFightDuration(fight);
      const retainedEvents = (fight.events ?? []).filter((event) => {
        const eventType = String(event.eventType ?? event.type ?? '').replace(/\s+/g, '').toLowerCase();
        const abilityId = Number(event.abilityId ?? event.abilityGameID ?? event.ability?.id);
        return eventType !== 'cast' || !trackedAbilityIds.has(abilityId);
      });
      const phaseStarts = resolveEncounterPhaseStarts(
        DANCING_MAD_ENCOUNTER_NAME,
        fight,
        extractPhaseReferenceEvents(retainedEvents, actorNames),
      );
      const partySlots = mapPartyMembersToPlanSlots(normalizePartyMembers(actors, new Set(friendlyPlayers)));
      const mitigationEvents = getDancingMadMitigations().flatMap((mitigation, mitigationIndex) => {
        const supportedJobs = getMitigationJobs(mitigation);
        const assignedPlayer = partySlots.get(mitigation.assignedTo);
        const isTankSlot = ['MT', 'OT'].includes(mitigation.assignedTo);
        const sourcePlayer = supportedJobs.includes(assignedPlayer?.job)
          ? assignedPlayer
          : isTankSlot
            ? null
            : supportedJobs.map((job) => playerByJob.get(job)).find(Boolean);
        if (!sourcePlayer) return [];
        const relativeAnchorMs = phaseStarts.get(Number(mitigation.phase));
        if (!Number.isFinite(relativeAnchorMs)) return [];
        const startMs = relativeAnchorMs + Number(mitigation.startElapsedSeconds) * 1000;
        const endMs = relativeAnchorMs + Number(mitigation.endElapsedSeconds) * 1000;
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > durationMs) return [];
  
        const isP1OnlyTemperanceSample = report.code === 'TESTP1ONLY02'
          && mitigation.ability === 'Temperance'
          && Number(mitigation.phase) === 1
          && Number(mitigation.startElapsedSeconds) < 30;
        const scenario = (reportIndex * 3 + Number(fight.id) + mitigationIndex) % 7;
        if (scenario === 0 && !isP1OnlyTemperanceSample) return [];
        const castElapsedMs = isP1OnlyTemperanceSample
          ? startMs + 1_000 + (Number(fight.id) - 1) * 200
          : scenario === 1
            ? startMs - 3_200
            : scenario === 2
              ? endMs + 2_200
              : scenario === 3
                ? startMs + 250
                : scenario === 4
                  ? endMs + 400
                  : scenario === 5
                    ? (startMs + endMs) / 2
                    : startMs - 350;
        if (castElapsedMs < 0 || castElapsedMs > durationMs) return [];
        return [{
          type: 'cast',
          abilityGameID: Number(mitigation.abilityId),
          sourceID: Number(sourcePlayer.id),
          timestamp: Number(fight.startTime) + castElapsedMs,
        }];
      });
  
      return {
        ...fight,
        friendlyPlayers,
        events: addTestPlayerActionCasts(
          fight,
          actors,
          [...retainedEvents, ...mitigationEvents],
        ),
      };
    });
    return { ...report, fights, testActors: actors };
  }
  
  // Keep the cross-pull action viewer usable when FFLogs is unavailable. Every local
  // DMU pull gets a repeatable mixture of GCDs, abilities, and auto-attacks for every
  // test player, including deliberately close casts that exercise marker stacking.
  function addTestPlayerActionCasts(fight, actors, existingEvents) {
    if (!isDmuPull(fight)) return existingEvents;
    const durationMs = getFightDuration(fight);
    // Use real Action-sheet identities so an icon never implies a different
    // category than the seeded event. Auto-attack intentionally has no local
    // icon and uses the normal unknown-icon fallback instead of borrowing one
    // from an unrelated ability.
    const actions = [
      { abilityGameID: 16532, abilityName: 'Dia', actionCategory: 'Spell', icon: './assets/ability-icons/002641_hr1.png' },
      { abilityGameID: 3569, abilityName: 'Asylum', actionCategory: 'Ability', icon: './assets/ability-icons/002632_hr1.png' },
      { abilityGameID: 7549, abilityName: 'Feint', actionCategory: 'Ability', icon: './assets/ability-icons/000828_hr1.png' },
      { abilityGameID: 7, abilityName: 'attack', actionCategory: 'Auto-attack' },
    ];
    const generated = actors
      .filter((actor) => actor.type === 'Player')
      .flatMap((actor, actorIndex) => {
        const casts = [];
        for (let elapsedMs = 1_000 + actorIndex * 125; elapsedMs <= durationMs; elapsedMs += 5_000) {
          const actionIndex = (Math.floor(elapsedMs / 5_000) + actorIndex) % actions.length;
          const action = actions[actionIndex];
          const isCastTimeAction = action.actionCategory === 'Spell' && elapsedMs >= 2_000;
          const isCancelled = isCastTimeAction
            && (Math.floor(elapsedMs / 5_000) + actorIndex + Number(fight.id)) % 6 === 0;
          if (isCastTimeAction) {
            casts.push({
              type: 'begincast',
              ...action,
              duration: 1_800,
              sourceID: Number(actor.id),
              timestamp: Number(fight.startTime) + elapsedMs - 1_800,
            });
          }
          casts.push({
            type: isCancelled ? 'castcancelled' : 'cast',
            ...action,
            sourceID: Number(actor.id),
            timestamp: Number(fight.startTime) + elapsedMs - (isCancelled ? 550 : 0),
          });
          if (actionIndex === 1 && elapsedMs + 180 <= durationMs) {
            casts.push({
              type: 'cast',
              ...actions[0],
              sourceID: Number(actor.id),
              timestamp: Number(fight.startTime) + elapsedMs + 180,
            });
          }
        }
        return casts;
      });
    return [...existingEvents, ...generated]
      .sort((first, second) => Number(first.timestamp) - Number(second.timestamp));
  }
  
  async function materializePaginatedTestReport(report) {
    if (!Array.isArray(report.eventPages)) return report;
    const pagesByStartTime = new Map(report.eventPages.map((page) => [page.startTime, page]));
    const events = await collectFflogsEventPages(async (startTime) => pagesByStartTime.get(startTime));
    const eventsByFight = new Map();
    for (const event of events) {
      const fightId = Number(event.fight);
      if (!eventsByFight.has(fightId)) eventsByFight.set(fightId, []);
      eventsByFight.get(fightId).push(event);
    }
    return {
      ...report,
      fights: report.fights.map((fight) => ({
        ...fight,
        events: eventsByFight.get(Number(fight.id)) ?? [],
      })),
    };
  }
  
  // Timeline labels and grouped event markers depend on their rendered pixel width,
  // which is unavailable until the browser finishes layout. Queue one recalculation
  // for the next frame and replace any older request caused by the same resize burst.
  

  return { addTestMitigationCasts, materializePaginatedTestReport };
}
