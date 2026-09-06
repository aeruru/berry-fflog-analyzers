const DAMAGE_DOWN_ID = 1002911;
const PLAYER_IDS = [1, 2, 3, 4, 5, 6, 7, 8];
const REFERENCE_TIMELINE_WIDTH_PX = 937;
const P1_DURATION_MS = 207_000;
const P4_DURATION_MS = 155_000;
const P3_AFTER_EQ_DURATION_MS = 185_000;

// Each pull contains 20 isolated scenarios. P3 gets an extra scenario because it is
// the longest/busiest phase, while short P4 gets one fewer; every other phase gets four.
const SCENARIO_CENTERS = [
  [30, 75, 125, 175],
  [225, 275, 330, 385],
  [440, 505, 585, 655, 715],
  [775, 825, 875],
  [930, 985, 1045, 1100],
];

export function createGroupingScenarioReport() {
  return {
    code: 'TESTGROUPS08',
    title: 'Test · 40 grouping scenarios',
    startTime: 1786636800000,
    endTime: 1786639120000,
    fights: [
      createGroupingFight(1, 0, 1_100_000, 0, true),
      createGroupingFight(2, 1_200_000, 2_320_000, 20, false),
    ],
  };
}

function createGroupingFight(id, startTime, endTime, scenarioOffset, kill) {
  const events = SCENARIO_CENTERS.flatMap((phaseCenters, phaseIndex) => phaseCenters
    .flatMap((centerSeconds) => {
      const scenarioIndex = scenarioOffset;
      scenarioOffset += 1;
      // The full-party death is the final event of a P5 wipe, 2.5 seconds before
      // the pull ends, rather than an event attached to a successful clear.
      const scenarioCenterMs = scenarioIndex === 39
        ? endTime - 2_500
        : startTime + centerSeconds * 1000;
      return createScenarioEvents(
        scenarioCenterMs,
        scenarioIndex,
        phaseIndex,
        centerSeconds,
      );
    }));

  return {
    id,
    encounterID: 1085,
    startTime,
    endTime,
    kill,
    bossPercentage: kill ? 0 : 1,
    lastPhase: 5,
    friendlyPlayers: PLAYER_IDS,
    events,
  };
}

// Five cases deliberately sit just beyond the grouping boundary and fragment into
// progressively more markers. Their gaps remain real timestamps; the phase-aware
// durations merely make them approximately one rendered pixel too far apart at the
// fixture's normal desktop width.
const BARELY_UNGROUPED_SCENARIOS = new Map([
  [0, 2],
  [4, 3],
  [8, 4],
  [13, 7],
  [18, 10],
]);

// Counts, mixtures, and timing rotate independently. A party member appears no more
// than once per event kind in a scenario, DDs cap at eight, and deaths cap at seven.
function createScenarioEvents(centerMs, scenarioIndex, phaseIndex, centerSeconds) {
  const fragmentCount = BARELY_UNGROUPED_SCENARIOS.get(scenarioIndex);
  if (fragmentCount) {
    const events = createBarelyUngroupedScenario(
      centerMs,
      scenarioIndex,
      fragmentCount,
      getBarelyUngroupedGapMs(phaseIndex, centerSeconds),
    );
    if (scenarioIndex === 8) {
      // Put a compact three-death stack midway between the second and third DDs in
      // P3's four-piece near-miss, intentionally exercising mixed-box collisions.
      const damageDowns = events.filter((event) => event.type === 'applydebuff');
      const deathTimestamp = (damageDowns[1].timestamp + damageDowns[2].timestamp) / 2;
      events.push(
        death(deathTimestamp, PLAYER_IDS[4]),
        death(deathTimestamp, PLAYER_IDS[5]),
        death(deathTimestamp, PLAYER_IDS[6]),
      );
    }
    return events;
  }

  if (scenarioIndex === 30) {
    return createOverlappingLongStrings(centerMs, scenarioIndex);
  }

  if (scenarioIndex === 1) {
    return createAlternatingChain(centerMs, scenarioIndex);
  }

  if (scenarioIndex === 14) {
    return createFlippedBoundaryChain(centerMs, scenarioIndex);
  }

  // The final scenario intentionally models the sole allowed full-party death.
  if (scenarioIndex === 39) {
    return createEventRun('Death', 8, centerMs, scenarioIndex, 1_200, -4_200);
  }

  // The first clear also places its final scenario at the pull boundary. Shift its
  // center back by the pattern's maximum positive offset so no event is truncated.
  if (scenarioIndex === 19) {
    centerMs -= 7_500;
  }

  const patterns = [
    { damageDowns: 8, deaths: 0, stepMs: 1_800, separationMs: 0 },
    { damageDowns: 0, deaths: 7, stepMs: 2_200, separationMs: 0 },
    { damageDowns: 5, deaths: 3, stepMs: 2_600, separationMs: 1_000 },
    { damageDowns: 2, deaths: 6, stepMs: 2_000, separationMs: 5_000 },
    { damageDowns: 7, deaths: 0, stepMs: 3_000, separationMs: 0 },
    { damageDowns: 4, deaths: 4, stepMs: 2_400, separationMs: 2_000 },
    { damageDowns: 3, deaths: 7, stepMs: 1_900, separationMs: 3_000 },
    { damageDowns: 6, deaths: 2, stepMs: 2_800, separationMs: 4_000 },
  ];
  const pattern = patterns[scenarioIndex % patterns.length];

  return [
    ...createEventRun('Damage down', pattern.damageDowns, centerMs, scenarioIndex,
      pattern.stepMs, -pattern.separationMs / 2),
    ...createEventRun('Death', pattern.deaths, centerMs, scenarioIndex + 3,
      pattern.stepMs, pattern.separationMs / 2),
  ];
}

function createAlternatingChain(centerMs, scenarioIndex) {
  // First-pull science case: preserve this exact 12-marker order while deriving its
  // 21px separation from the P1 timeline duration instead of synthetic positions.
  const kinds = [
    'Death', 'Death',
    'Damage down', 'Damage down', 'Damage down',
    'Death',
    'Damage down', 'Damage down',
    'Death', 'Death',
    'Damage down',
    'Death',
  ];
  const eventStepMs = 21 * P1_DURATION_MS / REFERENCE_TIMELINE_WIDTH_PX;
  const firstTimestamp = centerMs - (kinds.length - 1) * eventStepMs / 2;
  let damageDownIndex = 0;
  let deathIndex = 0;

  return kinds.map((kind, index) => {
    // Advance the player sequence independently per kind so nobody receives the
    // same DD or death twice within this grouping scenario.
    const kindIndex = kind === 'Death' ? deathIndex++ : damageDownIndex++;
    const targetID = PLAYER_IDS[(scenarioIndex + kindIndex) % PLAYER_IDS.length];
    const timestamp = firstTimestamp + index * eventStepMs;
    return kind === 'Death' ? death(timestamp, targetID) : damageDown(timestamp, targetID);
  });
}

function createFlippedBoundaryChain(centerMs, scenarioIndex) {
  // This P4 case flips the P1 sequence to exercise multi→multi, single→multi,
  // multi→single, and single→single candidate boundaries in the other direction.
  const kinds = [
    'Damage down', 'Damage down',
    'Death', 'Death', 'Death',
    'Damage down',
    'Death', 'Death',
    'Damage down', 'Damage down',
    'Death',
    'Damage down',
  ];
  const millisecondsPerPixel = P4_DURATION_MS / REFERENCE_TIMELINE_WIDTH_PX;
  const pixelOffsets = [0];
  for (let index = 1; index < kinds.length; index += 1) {
    // Same-kind markers remain groupable at 21px; a type transition lands exactly
    // on the 22px boundary so the mixed-candidate collision path decides the result.
    const gapPixels = kinds[index] === kinds[index - 1] ? 21 : 22;
    pixelOffsets.push(pixelOffsets.at(-1) + gapPixels);
  }

  const midpointPixels = pixelOffsets.at(-1) / 2;
  let damageDownIndex = 0;
  let deathIndex = 0;
  return kinds.map((kind, index) => {
    const kindIndex = kind === 'Death' ? deathIndex++ : damageDownIndex++;
    const targetID = PLAYER_IDS[(scenarioIndex + kindIndex) % PLAYER_IDS.length];
    const timestamp = centerMs + (pixelOffsets[index] - midpointPixels) * millisecondsPerPixel;
    return kind === 'Death' ? death(timestamp, targetID) : damageDown(timestamp, targetID);
  });
}

function createOverlappingLongStrings(centerMs, scenarioIndex) {
  // At the fixture's normal width, both same-type strings use 21px-equivalent
  // timeline gaps while their centers are 100px apart. Their true spans overlap,
  // verifying that footprint-aware mixed grouping joins the two strings.
  const millisecondsPerPixel = P3_AFTER_EQ_DURATION_MS / REFERENCE_TIMELINE_WIDTH_PX;
  const eventStepMs = 21 * millisecondsPerPixel;
  const centerSeparationMs = 100 * millisecondsPerPixel;
  return [
    ...createEventRun('Damage down', 8, centerMs, scenarioIndex, eventStepMs, 0),
    ...createEventRun('Death', 7, centerMs + centerSeparationMs,
      scenarioIndex + 3, eventStepMs, 0),
  ];
}

function getBarelyUngroupedGapMs(phaseIndex, centerSeconds) {
  const phaseThreeIsAfterEq = phaseIndex === 2 && centerSeconds >= 560;
  if (phaseThreeIsAfterEq) {
    return 4_100;
  }
  return [5_000, 5_100, 3_350, 3_700, 4_800][phaseIndex];
}

function createBarelyUngroupedScenario(centerMs, scenarioIndex, count, gapMs) {
  const firstTimestamp = centerMs - (count - 1) * gapMs / 2;
  let damageDownIndex = 0;
  let deathIndex = 0;

  return Array.from({ length: count }, (_, index) => {
    const kind = count <= 7 ? (scenarioIndex % 2 === 0 ? 'Damage down' : 'Death')
      : (index % 2 === 0 ? 'Damage down' : 'Death');
    const kindIndex = kind === 'Death' ? deathIndex++ : damageDownIndex++;
    const targetID = PLAYER_IDS[(scenarioIndex + kindIndex) % PLAYER_IDS.length];
    const timestamp = firstTimestamp + index * gapMs;
    return kind === 'Death' ? death(timestamp, targetID) : damageDown(timestamp, targetID);
  });
}

function createEventRun(kind, count, timestamp, playerOffset, stepMs, centerOffsetMs) {
  return Array.from({ length: count }, (_, index) => {
    const targetID = PLAYER_IDS[(playerOffset + index) % PLAYER_IDS.length];
    const timelineOffsetMs = (index - (count - 1) / 2) * stepMs + centerOffsetMs;
    return kind === 'Death'
      ? death(timestamp + timelineOffsetMs, targetID)
      : damageDown(timestamp + timelineOffsetMs, targetID);
  });
}

function damageDown(timestamp, targetID) {
  return {
    type: 'applydebuff',
    abilityGameID: DAMAGE_DOWN_ID,
    targetID,
    timestamp,
  };
}

function death(timestamp, targetID) {
  return { type: 'death', targetID, timestamp };
}
