const PHASE_START_SECONDS = new Map([[1, 0], [2, 207], [3, 421.054]]);
const RANGED_PLAYERS = [
  { id: 7, job: 'BRD' },
  { id: 9, job: 'DNC' },
  { id: 10, job: 'MCH' },
];
const SLOT_PLAYERS = new Map([
  ['H1', { id: 3, job: 'WHM' }],
  ['H2', { id: 4, job: 'SGE' }],
  ['M1', { id: 5, job: 'DRG' }],
  ['M2', { id: 6, job: 'NIN' }],
]);
const PULL_TIMING_OFFSETS = [-4.2, -2.6, -0.7, 0.2, 0.8, 1.6, 2.9, 4.7, 8.3];

export function createOneEventPageReport(mitigations) {
  const fights = [];
  const events = [];

  for (let pullIndex = 0; pullIndex < 9; pullIndex += 1) {
    const fight = createFight(pullIndex);
    const rangedPlayer = RANGED_PLAYERS[pullIndex % RANGED_PLAYERS.length];
    const phaseFourStartSeconds = 735 + pullIndex * 2.137;
    fights.push({
      ...fight,
      friendlyPlayers: [1, 2, 3, 4, 5, 6, rangedPlayer.id, 8],
    });
    events.push({
      fight: fight.id,
      eventType: 'Begin Cast',
      ability: 'Kefka Says',
      source: 'Kefka',
      timestamp: fight.startTime + phaseFourStartSeconds * 1000,
    });
    const targetId = 8;
    // P5 begins 150 seconds after the event-driven P4 transition. Ultima Repeater
    // resolves about 15-18 seconds into P5, so keep the fixture deaths in that span.
    const detailsBaseSeconds = phaseFourStartSeconds + 165 + pullIndex * 0.173;
    events.push(
      {
        fight: fight.id,
        type: 'damage',
        abilityGameID: 900_000 + pullIndex,
        abilityName: 'Ultima Repeater',
        targetID: targetId,
        timestamp: fight.startTime + detailsBaseSeconds * 1000,
      },
      {
        fight: fight.id,
        type: 'applydebuff',
        abilityGameID: 1002911,
        targetID: targetId,
        timestamp: fight.startTime + (detailsBaseSeconds + 1.111) * 1000,
      },
      {
        fight: fight.id,
        type: 'death',
        targetID: targetId,
        timestamp: fight.startTime + (detailsBaseSeconds + 2.222) * 1000,
      },
    );

    mitigations.forEach((mitigation) => {
      const player = mitigation.assignedTo === 'R1'
        ? rangedPlayer
        : SLOT_PLAYERS.get(mitigation.assignedTo);
      const supportedJobs = Array.isArray(mitigation.class) ? mitigation.class : [mitigation.class];
      if (!player || !supportedJobs.includes(player.job)) return;

      const phaseStartSeconds = Number(mitigation.phase) === 4
        ? phaseFourStartSeconds
        : PHASE_START_SECONDS.get(Number(mitigation.phase));
      if (!Number.isFinite(phaseStartSeconds)) return;
      const startSeconds = phaseStartSeconds + Number(mitigation.startElapsedSeconds);
      const abilityJitter = (Number(mitigation.abilityId) % 17) * 0.001;
      const castSeconds = startSeconds + PULL_TIMING_OFFSETS[pullIndex] + abilityJitter;
      events.push({
        fight: fight.id,
        type: 'cast',
        abilityGameID: Number(mitigation.abilityId),
        sourceID: player.id,
        timestamp: fight.startTime + castSeconds * 1000,
      });
    });
  }

  events.sort((first, second) => Number(first.timestamp) - Number(second.timestamp));
  return {
    code: 'TESTPAGEONE1',
    title: 'Test · One unique event per page',
    startTime: 1787328000000,
    endTime: 1787338800000,
    fights,
    preserveTestEvents: true,
    eventPages: events.map((event, index) => ({
      startTime: index === 0 ? null : index,
      data: [event],
      nextPageTimestamp: index + 1 < events.length ? index + 1 : null,
    })),
  };
}

function createFight(pullIndex) {
  const startTime = pullIndex * 1_200_000;
  return {
    id: pullIndex + 1,
    encounterID: 1085,
    startTime,
    endTime: startTime + 1_050_000 + pullIndex * 1_000,
    kill: false,
    bossPercentage: 21.8 + pullIndex * 0.3,
    lastPhase: 5,
  };
}
