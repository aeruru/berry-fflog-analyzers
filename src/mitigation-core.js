// Evaluates mitigation assignments, party slots, timing results, history data, and shared colors.
export function createMitigationCore(dependencies) {
  const {
    DANCING_MAD_ENCOUNTER_NAME,
    DMU_ENCOUNTER_ID,
    MITIGATION_GRACE_SECONDS,
    UNKNOWN_MITIGATION_ABILITY_ICON_URL,
    ensureReportFightDetails,
    getDancingMadMechanic,
    getEventAbilityName,
    getFightDetails,
    getFightDuration,
    getFightFingerprint,
    getMitigationAbilitiesById,
    getMitigationCooldowns,
    getMitigationHistoryPromises,
    getMitigationIdentity,
    getTrackedMitigations,
    normalizeEventType,
    normalizeJobAbbreviation,
    resolveEncounterPhaseStarts,
  } = dependencies;

  async function loadMitigationResultHistory(report, mitigation) {
    const reportFingerprint = (report.fights ?? []).map(getFightFingerprint).join('|');
    const slotCacheKey = `${report.code}:${reportFingerprint}:slot:${mitigation.assignedTo}`;
    if (!getMitigationHistoryPromises().has(slotCacheKey)) {
      getMitigationHistoryPromises().set(slotCacheKey, (async () => {
        const rowsByMitigation = new Map();
        const fights = (report.fights ?? [])
          .filter((fight) => Number(fight.encounterID) === DMU_ENCOUNTER_ID);
        await ensureReportFightDetails(report, fights);
  
        for (const fight of fights) {
          const state = getFightDetails().get(`${report.code}:${fight.id}`);
          if (!state || state.status !== 'ready') continue;
          for (const result of evaluatePartySlotMitigations(fight, state, mitigation.assignedTo)) {
            const identity = getMitigationIdentity(result.mitigation);
            if (!rowsByMitigation.has(identity)) rowsByMitigation.set(identity, []);
            rowsByMitigation.get(identity).push({ fight, result });
          }
        }
        for (const rows of rowsByMitigation.values()) {
          rows.sort((first, second) => Number(first.fight.id) - Number(second.fight.id));
        }
        return rowsByMitigation;
      })());
    }
    const rowsByMitigation = await getMitigationHistoryPromises().get(slotCacheKey);
    return rowsByMitigation.get(getMitigationIdentity(mitigation)) ?? [];
  }
  
  // Populate the shared per-pull cache for report-wide comparison views. Restored
  // pulls cost no FFLogs usage; genuinely missing pulls are fetched in small batches.
  

  function createMitigationAbilityIcon(abilityId, abilityName) {
    const icon = document.createElement('span');
    icon.className = 'mitigation-ability-icon';
    const abilityDefinition = getMitigationAbilitiesById().get(Number(abilityId));
    const iconUrl = abilityDefinition?.icon
      ?? UNKNOWN_MITIGATION_ABILITY_ICON_URL;
  
    const image = document.createElement('img');
    image.src = iconUrl;
    image.alt = '';
    image.loading = 'lazy';
    if (!abilityDefinition?.icon) {
      icon.setAttribute('aria-label', `Unknown ability icon for ${abilityName}`);
    }
    image.addEventListener('error', () => icon.replaceChildren(), { once: true });
    icon.append(image);
    return icon;
  }
  
  // Compare one party slot's planned mitigation windows with that player's actual
  // casts. Each cast can satisfy at most one assignment; the nearest eligible unused
  // cast is marked on-time, early, or late, and an unmatched assignment is missing.
  function evaluatePartySlotMitigations(fight, state, assignedTo) {
    const durationMs = getFightDuration(fight);
    const partySlots = mapPartyMembersToPlanSlots(state.partyMembers ?? [], state.tankSlots);
    const phaseStarts = resolveEncounterPhaseStarts(
      DANCING_MAD_ENCOUNTER_NAME,
      fight,
      state.phaseReferenceEvents ?? [],
    );
    const usedCastIndexes = new Set();
    const results = [];
  
    for (const mitigation of getTrackedMitigations().filter((entry) => entry.assignedTo === assignedTo)) {
      const requiredJobs = getMitigationJobs(mitigation);
      const assignedPlayer = partySlots.get(assignedTo);
      const isTankSlot = ['MT', 'OT'].includes(assignedTo);
      const player = requiredJobs.length > 0
        ? (requiredJobs.includes(assignedPlayer?.job)
          ? assignedPlayer
          : isTankSlot
            ? null
            : (state.partyMembers ?? []).find((member) => requiredJobs.includes(member.job)))
        : assignedPlayer;
      if (!player) continue;
  
      const phase = Number(mitigation.phase);
      const relativeAnchorMs = phaseStarts.get(phase);
      if (!Number.isFinite(relativeAnchorMs)) continue;
      const startMs = relativeAnchorMs + Number(mitigation.startElapsedSeconds) * 1000;
      const endMs = relativeAnchorMs + Number(mitigation.endElapsedSeconds) * 1000;
      if (startMs > durationMs) continue;
  
      const earliestMs = startMs - MITIGATION_GRACE_SECONDS * 1000;
      const latestMs = endMs + MITIGATION_GRACE_SECONDS * 1000;
      const candidates = (state.mitigationCasts ?? [])
        .map((cast, index) => ({ ...cast, index, elapsedMs: cast.timestamp - Number(fight.startTime) }))
        .filter((cast) => !usedCastIndexes.has(cast.index)
          && cast.abilityId === Number(mitigation.abilityId)
          && (cast.sourceId === player.id || cast.source === player.name)
          && cast.elapsedMs >= earliestMs
          && cast.elapsedMs <= latestMs)
        .sort((first, second) => mitigationCastDistance(first.elapsedMs, startMs, endMs)
          - mitigationCastDistance(second.elapsedMs, startMs, endMs));
      const cast = candidates[0] ?? null;
      if (cast) usedCastIndexes.add(cast.index);
  
      let status = 'Missed';
      let statusClass = 'missed';
      let statusColor = '#fb7185';
      let timingDeltaSeconds = null;
      let cooldownPreviousCast = null;
      if (cast && cast.elapsedMs < startMs) {
        const deltaSeconds = (startMs - cast.elapsedMs) / 1000;
        timingDeltaSeconds = deltaSeconds;
        status = `${formatMitigationDelta(deltaSeconds)} early`;
        statusClass = 'early';
        statusColor = getMitigationTimingStatusColor(deltaSeconds, 'early');
      } else if (cast && cast.elapsedMs > endMs) {
        const deltaSeconds = (cast.elapsedMs - endMs) / 1000;
        timingDeltaSeconds = deltaSeconds;
        status = `${formatMitigationDelta(deltaSeconds)} late`;
        statusClass = 'late';
        statusColor = getMitigationTimingStatusColor(deltaSeconds, 'late');
      } else if (cast) {
        timingDeltaSeconds = 0;
        status = 'On time';
        statusClass = 'on-time';
        statusColor = '#34d399';
      } else if (isPlayerDeadAt(
        state.lifeEvents ?? [],
        state.mitigationCasts ?? [],
        player,
        Number(fight.startTime) + endMs,
      )) {
        status = 'Dead';
        statusClass = 'missed dead';
      } else {
        cooldownPreviousCast = getMitigationCooldownPreviousCast(
          state.mitigationCasts ?? [], mitigation, player, fight, endMs,
        );
        if (cooldownPreviousCast) {
          status = 'On cooldown';
          statusClass = 'missed on-cooldown';
        }
      }

      const cooldownMechanic = cooldownPreviousCast
        ? getDancingMadMechanic(cooldownPreviousCast.elapsedMs, phaseStarts)
        : null;
  
      results.push({
        mitigation,
        player,
        startMs,
        endMs,
        cast,
        status,
        statusClass,
        statusColor,
        timingDeltaSeconds,
        cooldownPreviousCast,
        cooldownMechanic,
      });
    }
    return results;
  }
  
  function isPlayerDeadAt(lifeEvents, casts, player, timestamp) {
    const lifeTransitions = lifeEvents
      .filter((event) => event.playerId === Number(player.id) && event.timestamp <= timestamp);
    const proofOfLife = casts
      .filter((cast) => (cast.sourceId === Number(player.id) || cast.source === player.name)
        && cast.timestamp <= timestamp)
      .map((cast) => ({ type: 'alive', timestamp: cast.timestamp }));
    const latest = [...lifeTransitions, ...proofOfLife]
      .sort((first, second) => first.timestamp - second.timestamp)
      .at(-1);
    return latest?.type === 'death';
  }
  
  function getMitigationCooldownPreviousCast(casts, mitigation, player, fight, windowEndMs) {
    const cooldownSeconds = getMitigationCooldowns().get(mitigation.ability);
    if (!Number.isFinite(cooldownSeconds) || cooldownSeconds <= 0) return null;
    const fightStart = Number(fight.startTime);
    const previousCast = casts
      .filter((cast) => cast.abilityId === Number(mitigation.abilityId)
        && (cast.sourceId === player.id || cast.source === player.name)
        && cast.timestamp - fightStart < windowEndMs)
      .sort((first, second) => second.timestamp - first.timestamp)[0];
    if (!previousCast) return null;
    const elapsedMs = previousCast.timestamp - fightStart;
    return elapsedMs + cooldownSeconds * 1000 > windowEndMs
      ? { ...previousCast, elapsedMs }
      : null;
  }
  
  // Map real party members onto the encounter plan's role slots. Tanks use the
  // encounter-specific positional inference below; healers, melee, and ranged
  // members keep API order within their respective role.
  function mapPartyMembersToPlanSlots(partyMembers, tankSlots = null) {
    const slots = new Map();
    if (tankSlots?.MT) slots.set('MT', tankSlots.MT);
    if (tankSlots?.OT) slots.set('OT', tankSlots.OT);
    const roleSlots = new Map([
      ['Healer', ['H1', 'H2']],
      ['Melee', ['M1', 'M2']],
      ['Ranged', ['R1', 'R2']],
    ]);
    for (const [role, availableSlots] of roleSlots) {
      partyMembers.filter((member) => member.role === role).slice(0, 2)
        .forEach((member, index) => slots.set(availableSlots[index], member));
    }
    return slots;
  }
  
  function getMitigationJobs(mitigation) {
    const jobs = Array.isArray(mitigation.class) ? mitigation.class : [mitigation.class];
    return jobs.map(normalizeJobAbbreviation).filter(Boolean);
  }
  
  // Dancing Mad establishes its tank assignments from the geometry at the second
  // completed Revolting Ruin III cast. The tank whose bearing from Kefka is closest
  // to Kefka's facing is the MT; the other tank is the OT.
  function inferTankPlanSlots(events, partyMembers) {
    const tanks = partyMembers.filter((member) => member.role === 'Tank').slice(0, 2);
    if (tanks.length < 2) return null;
  
    const revoltingRuinCasts = events
      .filter((event) => normalizeEventType(event.eventType ?? event.type) === 'cast')
      .filter((event) => getEventAbilityName(event) === 'Revolting Ruin III')
      .sort((first, second) => Number(first.timestamp) - Number(second.timestamp));
    const referenceEvent = revoltingRuinCasts[1];
    if (!referenceEvent) return defaultTankPlanSlots(tanks);
  
    const timestamp = Number(referenceEvent.timestamp);
    const kefkaId = Number(referenceEvent.sourceID ?? referenceEvent.sourceId);
    const kefkaSnapshot = getActorPositionSnapshot(events, kefkaId, timestamp);
    const facing = getResourceFacing(referenceEvent.sourceResources)
      ?? getFiniteNumber(referenceEvent.sourceFacing, referenceEvent.facing)
      ?? kefkaSnapshot?.facing;
    if (!kefkaSnapshot || !Number.isFinite(facing)) return defaultTankPlanSlots(tanks);
  
    const rankedTanks = tanks.map((tank, index) => {
      const snapshot = getActorPositionSnapshot(events, tank.id, timestamp);
      if (!snapshot) return { tank, index, difference: Number.POSITIVE_INFINITY };
      const bearing = Math.atan2(snapshot.x - kefkaSnapshot.x, snapshot.y - kefkaSnapshot.y);
      return { tank, index, difference: angularDifference(bearing, facing) };
    }).sort((first, second) => first.difference - second.difference || first.index - second.index);
  
    if (!Number.isFinite(rankedTanks[0].difference)) return defaultTankPlanSlots(tanks);
    return { MT: rankedTanks[0].tank, OT: rankedTanks[1].tank };
  }
  
  function defaultTankPlanSlots(tanks) {
    return { MT: tanks[0], OT: tanks[1] };
  }
  
  function getActorPositionSnapshot(events, actorId, timestamp) {
    let nearest = null;
    for (const event of events) {
      const eventTimestamp = Number(event.timestamp);
      if (!Number.isFinite(eventTimestamp)) continue;
      for (const [eventActorId, resources] of [
        [Number(event.sourceID ?? event.sourceId), event.sourceResources],
        [Number(event.targetID ?? event.targetId), event.targetResources],
      ]) {
        if (eventActorId !== actorId) continue;
        const x = getFiniteNumber(resources?.x);
        const y = getFiniteNumber(resources?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const distance = Math.abs(eventTimestamp - timestamp);
        if (!nearest || distance < nearest.distance) {
          nearest = { x, y, facing: getResourceFacing(resources), distance };
        }
      }
    }
    return nearest;
  }
  
  function getResourceFacing(resources) {
    return getFiniteNumber(resources?.facing, resources?.heading, resources?.rotation);
  }
  
  function getFiniteNumber(...values) {
    for (const value of values) {
      if (value === null || value === undefined || value === '') continue;
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
    return null;
  }
  
  function angularDifference(first, second) {
    return Math.abs(Math.atan2(Math.sin(first - second), Math.cos(first - second)));
  }
  
  function mitigationCastDistance(elapsedMs, startMs, endMs) {
    if (elapsedMs < startMs) return startMs - elapsedMs;
    if (elapsedMs > endMs) return elapsedMs - endMs;
    return 0;
  }
  
  function formatMitigationDelta(seconds) {
    const rounded = Math.round(seconds * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}s`;
  }
  
  // Convert an early/late offset into the status color shown beside a cast. Early
  // casts receive a wider warning ramp because their effects may still overlap the
  // mechanic, while late casts reach red sooner because mitigation arrived too late.
  function getMitigationTimingStatusColor(seconds, timing) {
    const green = [52, 211, 153];
    const yellowGreen = [163, 230, 53];
    const yellow = [251, 191, 36];
    const red = [239, 68, 68];
    const greenLimit = timing === 'early' ? 0.5 : 0;
    if (seconds <= greenLimit) return rgbColor(green);
    if (seconds <= 1.5) return interpolateColor(green, yellowGreen, (seconds - greenLimit) / (1.5 - greenLimit));
    if (seconds <= 2.5) return interpolateColor(yellowGreen, yellow, seconds - 1.5);
    if (seconds <= 4) return interpolateColor(yellow, red, (seconds - 2.5) / 1.5);
    return rgbColor(red);
  }
  
  function interpolateColor(start, end, progress) {
    const amount = Math.max(0, Math.min(1, progress));
    return rgbColor(start.map((channel, index) => Math.round(channel + (end[index] - channel) * amount)));
  }
  
  function rgbColor(channels) {
    return `rgb(${channels.join(', ')})`;
  }
  
  

  return {
    createMitigationAbilityIcon,
    evaluatePartySlotMitigations,
    getFiniteNumber,
    getMitigationJobs,
    getMitigationTimingStatusColor,
    inferTankPlanSlots,
    interpolateColor,
    loadMitigationResultHistory,
    mapPartyMembersToPlanSlots,
    mitigationCastDistance,
    rgbColor,
  };
}
