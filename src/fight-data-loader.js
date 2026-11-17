// Loads and validates the static encounter, mechanic, mitigation, ability, and cooldown data used by the analyzers.
export function createFightDataLoader(dependencies) {
  const {
    PARTY_SLOT_ORDER,
    getMitigationAbilitiesByName,
    setDancingMadMechanics,
    setDancingMadMitigations,
    setDancingMadLilyUsages,
    setEncounterPhaseDefinitions,
    setMitigationAbilities,
    setMitigationCooldowns,
  } = dependencies;

  async function loadEncounterPhaseDefinitions() {
    const response = await fetch('./fight-data/encounter-phases.json');
    if (!response.ok) throw new Error(`Encounter phase data returned ${response.status}.`);
    const definitions = await response.json();
    setEncounterPhaseDefinitions(new Map(Object.entries(definitions)));
  }

  async function loadDancingMadMechanics() {
    const response = await fetch('./fight-data/dancing-mad-mechs.json');
    if (!response.ok) throw new Error(`Dancing Mad mechanic data returned ${response.status}.`);
    const mechanics = await response.json();
    setDancingMadMechanics(mechanics
      .filter((entry) => Number.isFinite(Number(entry.elapsedSeconds)))
      .sort(comparePhaseRelativeEntries));
  }

  async function loadDancingMadLilyUsages() {
    const response = await fetch('./fight-data/dancing-mad-lily-usages.json');
    if (!response.ok) throw new Error(`Dancing Mad lily usage data returned ${response.status}.`);
    const document = await response.json();
    const usages = document?.usages;
    if (!Array.isArray(usages)) {
      throw new Error('Dancing Mad lily usage data must contain a usages array.');
    }
    setDancingMadLilyUsages(usages
      .map((entry) => ({
        phase: Number(entry.phase),
        elapsedSeconds: Number(entry.elapsedSeconds),
      }))
      .filter((entry) => Number.isInteger(entry.phase)
        && entry.phase >= 1
        && entry.phase <= 5
        && Number.isFinite(entry.elapsedSeconds)
        && entry.elapsedSeconds >= 0)
      .sort(comparePhaseRelativeEntries));
  }

  async function loadMitigationAbilities() {
    const response = await fetch('./fight-data/fflogs-abilities.json');
    if (!response.ok) throw new Error(`FFLogs ability data returned ${response.status}.`);

    const definitions = await response.json();
    const abilities = Object.entries(definitions).map(([id, definition]) => ({
      id: Number(id),
      name: String(definition?.name ?? ''),
      icon: String(definition?.icon ?? ''),
    })).filter((ability) => Number.isFinite(ability.id) && ability.name);
    const duplicateNames = abilities.map((ability) => ability.name)
      .filter((name, index, names) => names.indexOf(name) !== index);
    if (duplicateNames.length > 0) {
      throw new Error(`FFLogs ability data contains duplicate names: ${[...new Set(duplicateNames)].join(', ')}.`);
    }
    setMitigationAbilities(
      new Map(abilities.map((ability) => [ability.id, ability])),
      new Map(abilities.map((ability) => [ability.name, ability])),
    );
  }

  async function loadDancingMadMitigations() {
    const directory = './fight-data/dancing-mad-mitigations';
    const manifestResponse = await fetch(`${directory}/index.json`);
    if (!manifestResponse.ok) {
      throw new Error(`Dancing Mad mitigation manifest returned ${manifestResponse.status}.`);
    }
    const manifest = await manifestResponse.json();
    if (!Array.isArray(manifest.roles) || manifest.roles.length === 0) {
      throw new Error('Dancing Mad mitigation manifest does not list any role files.');
    }
    const roleFiles = await Promise.all(manifest.roles.map(async (assignedTo) => {
      if (!PARTY_SLOT_ORDER.includes(assignedTo)) {
        throw new Error(`Dancing Mad mitigation manifest lists unknown role ${assignedTo}.`);
      }
      const fileName = `${assignedTo}.json`;
      const response = await fetch(`${directory}/${fileName}`);
      if (!response.ok) {
        throw new Error(`Dancing Mad mitigation file ${fileName} returned ${response.status}.`);
      }
      const entries = await response.json();
      if (!Array.isArray(entries)) {
        throw new Error(`Dancing Mad mitigation file ${fileName} is not an array.`);
      }
      if (entries.some((entry) => entry.assignedTo !== assignedTo)) {
        throw new Error(`Dancing Mad mitigation file ${fileName} contains another role's assignment.`);
      }
      return entries;
    }));
    const mitigationAbilitiesByName = getMitigationAbilitiesByName();
    const mitigations = roleFiles.flat();
    const unknownAbilities = [...new Set(mitigations
      .map((entry) => entry.ability)
      .filter((abilityName) => !mitigationAbilitiesByName.has(abilityName)))];
    if (unknownAbilities.length > 0) {
      throw new Error(`Dancing Mad mitigation data references unknown abilities: ${unknownAbilities.join(', ')}.`);
    }
    setDancingMadMitigations(mitigations
      .map((entry) => ({
        ...entry,
        abilityId: mitigationAbilitiesByName.get(entry.ability)?.id,
      }))
      .filter((entry) => Number.isFinite(entry.abilityId)
        && Number.isFinite(Number(entry.phase))
        && Number.isFinite(Number(entry.startElapsedSeconds))
        && Number.isFinite(Number(entry.endElapsedSeconds))
        && PARTY_SLOT_ORDER.includes(entry.assignedTo))
      .sort(comparePhaseRelativeEntries));
  }

  function comparePhaseRelativeEntries(first, second) {
    return Number(first.phase) - Number(second.phase)
      || Number(first.startElapsedSeconds ?? first.elapsedSeconds)
        - Number(second.startElapsedSeconds ?? second.elapsedSeconds);
  }

  async function loadMitigationCooldowns() {
    const response = await fetch('./fight-data/mitigation-cooldowns.json');
    if (!response.ok) throw new Error(`Mitigation cooldown data returned ${response.status}.`);
    const cooldowns = await response.json();
    const mitigationAbilitiesByName = getMitigationAbilitiesByName();
    const unknownAbilities = Object.keys(cooldowns)
      .filter((abilityName) => !mitigationAbilitiesByName.has(abilityName));
    if (unknownAbilities.length > 0) {
      throw new Error(`Mitigation cooldown data references unknown abilities: ${unknownAbilities.join(', ')}.`);
    }
    setMitigationCooldowns(new Map(Object.entries(cooldowns)
      .map(([abilityName, seconds]) => [abilityName, Number(seconds)])
      .filter(([, seconds]) => Number.isFinite(seconds) && seconds >= 0)));
  }

  return {
    loadDancingMadMechanics,
    loadDancingMadLilyUsages,
    loadDancingMadMitigations,
    loadEncounterPhaseDefinitions,
    loadMitigationAbilities,
    loadMitigationCooldowns,
  };
}
