// Coordinates fight-detail loading, normalization, caching, invalidation, and panel rendering.
export function createFightDetailsController(dependencies) {
  const {
    DANCING_MAD_ENCOUNTER_NAME,
    createFightDetailsTable,
    createFightTimeline,
    fetchFightEventDetails,
    fightDetailsCache,
    getEncounterEventReferences,
    getFightDetails,
    getIsDetailsTableVisible,
    getMitigationHistoryPromises,
    getOpenFightDetailKeys,
    getOpenFightMitigationKeys,
    getTrackedMitigations,
    getUsingTestData,
    normalizeEmbeddedFightDetails,
    normalizeFightDetails,
    renderLookupResult,
    setLookupStatus,
  } = dependencies;

  async function toggleFightDetails(report, fight) {
    return toggleFightPanelWithLoadedState(report, fight, getOpenFightDetailKeys());
  }

  async function toggleFightMitigations(report, fight) {
    return toggleFightPanelWithLoadedState(report, fight, getOpenFightMitigationKeys());
  }

  async function reloadFightDetails(report, fight, button) {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Reloading…';
    setLookupStatus(`Reloading pull ${fight.id} from report ${report.code}…`);
    try {
      await clearFightDetailsCache(report.code, fight);
      renderLookupResult();
      await ensureReportFightDetails(report, [fight]);
      renderLookupResult();
      setLookupStatus(`Reloaded pull ${fight.id} from report ${report.code}.`);
    } catch (error) {
      renderLookupResult();
      setLookupStatus(`Could not reload pull ${fight.id}: ${error.message}`, true);
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  async function toggleFightPanelWithLoadedState(report, fight, openPanelKeys) {
    const fightDetails = getFightDetails();
    const key = `${report.code}:${fight.id}`;
    if (openPanelKeys.has(key)) {
      openPanelKeys.delete(key);
      renderLookupResult();
      return;
    }

    openPanelKeys.add(key);
    renderLookupResult();
    if (isCurrentFightDetailState(fightDetails.get(key), fight)) return;

    fightDetails.delete(key);
    if (getUsingTestData()) {
      fightDetails.set(key, attachFightFingerprint(normalizeEmbeddedFightDetails(report, fight), fight));
      renderLookupResult();
      return;
    }

    const cachedDetails = await readCachedFightDetails(report.code, fight);
    if (cachedDetails) {
      fightDetails.set(key, cachedDetails);
      renderLookupResult();
      return;
    }

    fightDetails.set(key, attachFightFingerprint({ status: 'loading' }, fight));
    renderLookupResult();
    try {
      const mitigationAbilityIds = [...new Set(getTrackedMitigations()
        .map((entry) => Number(entry.abilityId)))];
      const rawDetails = await fetchFightEventDetails(
        report.code,
        fight.id,
        mitigationAbilityIds,
        getEncounterEventReferences(DANCING_MAD_ENCOUNTER_NAME),
      );
      const normalizedDetails = attachFightFingerprint(normalizeFightDetails(rawDetails), fight);
      fightDetails.set(key, normalizedDetails);
      writeCachedFightDetails(report.code, fight, createRawFightDetailsCacheRecord(rawDetails, fight));
    } catch (error) {
      fightDetails.set(key, { status: 'error', error: error.message });
    }
    renderLookupResult();
  }

  function getEventAbilityName(event, abilityNames = new Map()) {
    if (!event) return null;
    const ability = event.ability?.name ?? event.abilityName
      ?? (typeof event.ability === 'string' ? event.ability : null);
    if (ability) return String(ability);
    const abilityId = Number(event.abilityGameID ?? event.abilityId ?? event.ability?.id);
    if (abilityNames.has(abilityId)) return abilityNames.get(abilityId);
    return abilityId === 1002911 ? 'Damage Down' : null;
  }

  function getFightFingerprint(fight) {
    return [fight.id, fight.startTime, fight.endTime, ...(fight.friendlyPlayers ?? [])].join(':');
  }

  function attachFightFingerprint(state, fight) {
    return { ...state, fightFingerprint: getFightFingerprint(fight) };
  }

  function createRawFightDetailsCacheRecord(rawDetails, fight) {
    const fightId = Number(fight.id);
    const scopedRawDetails = {
      ...rawDetails,
      fights: (rawDetails?.fights ?? []).filter((entry) => Number(entry.id) === fightId),
      events: {
        ...(rawDetails?.events ?? {}),
        data: (rawDetails?.events?.data ?? []).filter((event) => {
          const eventFightId = Number(event.fight);
          if (Number.isFinite(eventFightId)) return eventFightId === fightId;
          const timestamp = Number(event.timestamp);
          return timestamp >= Number(fight.startTime) && timestamp <= Number(fight.endTime);
        }),
        nextPageTimestamp: null,
      },
    };
    return {
      cacheFormat: 'raw-events-v1',
      fightFingerprint: getFightFingerprint(fight),
      rawDetails: scopedRawDetails,
    };
  }

  function materializeCachedFightDetails(cachedDetails, fight, options) {
    if (cachedDetails?.cacheFormat !== 'raw-events-v1' || !cachedDetails.rawDetails) {
      return cachedDetails;
    }
    return attachFightFingerprint(
      normalizeFightDetails(cachedDetails.rawDetails, fight.id, options),
      fight,
    );
  }

  function isCurrentFightDetailState(state, fight) {
    return state?.fightFingerprint === getFightFingerprint(fight);
  }

  function isReadyCurrentFightDetailState(state, fight) {
    return state?.status === 'ready'
      && state.detailLevel !== 'player-actions'
      && isCurrentFightDetailState(state, fight);
  }

  function isReadyPlayerActionFightDetailState(state, fight) {
    return state?.status === 'ready' && isCurrentFightDetailState(state, fight);
  }

  function discardChangedFightDetails(report) {
    const fightDetails = getFightDetails();
    const currentFights = new Map((report.fights ?? []).map((fight) => [String(fight.id), fight]));
    for (const [key, state] of fightDetails) {
      const [reportCode, fightId] = key.split(':');
      if (reportCode !== report.code) continue;
      const fight = currentFights.get(fightId);
      if (!fight || !isCurrentFightDetailState(state, fight)) fightDetails.delete(key);
    }
  }

  function getFightDetailsCacheVersion() {
    const abilityIds = getTrackedMitigations()
      .map((entry) => Number(entry.abilityId))
      .sort((a, b) => a - b);
    const phaseReferences = getEncounterEventReferences(DANCING_MAD_ENCOUNTER_NAME);
    return JSON.stringify({ version: 34, abilityIds, phaseReferences });
  }

  function getPersistentFightDetailsKey(reportCode, fight) {
    return `${getFightDetailsCacheVersion()}:${reportCode}:${getFightFingerprint(fight)}`;
  }

  async function readCachedFightDetails(reportCode, fight, options) {
    const cachedDetails = await fightDetailsCache.get(getPersistentFightDetailsKey(reportCode, fight));
    return materializeCachedFightDetails(cachedDetails, fight, options);
  }

  async function writeCachedFightDetails(reportCode, fight, state) {
    await fightDetailsCache.put(getPersistentFightDetailsKey(reportCode, fight), state);
  }

  async function clearReportFightDetailsCache(reportCode) {
    const keyPrefix = `${getFightDetailsCacheVersion()}:${reportCode}:`;
    await fightDetailsCache.removePrefix(keyPrefix);

    const fightDetails = getFightDetails();
    for (const key of fightDetails.keys()) {
      if (key.startsWith(`${reportCode}:`)) fightDetails.delete(key);
    }
    for (const key of getMitigationHistoryPromises().keys()) {
      if (key.startsWith(`${reportCode}:`)) getMitigationHistoryPromises().delete(key);
    }
  }

  async function clearFightDetailsCache(reportCode, fight) {
    await fightDetailsCache.remove(getPersistentFightDetailsKey(reportCode, fight));
    getFightDetails().delete(`${reportCode}:${fight.id}`);
    for (const key of getMitigationHistoryPromises().keys()) {
      if (key.startsWith(`${reportCode}:`)) getMitigationHistoryPromises().delete(key);
    }
  }

  function createFightDetailsPanel(fight, state) {
    const panel = document.createElement('div');
    panel.className = 'fight-details-panel';
    if (!state || state.status === 'loading') {
      panel.textContent = 'Loading death and damage down events...';
      return panel;
    }
    if (state.status === 'error') {
      panel.textContent = `Could not load fight events: ${state.error}`;
      return panel;
    }
    if (state.events.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'detailed-empty-state';
      empty.textContent = 'No deaths or damage downs in this fight.';
      panel.append(empty);
      return panel;
    }
    panel.replaceChildren(createFightTimeline(fight, state));
    if (getIsDetailsTableVisible()) panel.append(createFightDetailsTable(fight, state));
    return panel;
  }

  async function ensureReportFightDetails(report, fights, { playerActionsOnly = false } = {}) {
    const fightDetails = getFightDetails();
    const isReady = playerActionsOnly
      ? isReadyPlayerActionFightDetailState
      : isReadyCurrentFightDetailState;
    const initiallyUncachedFights = fights.filter((fight) => {
      const detailKey = `${report.code}:${fight.id}`;
      return !isReady(fightDetails.get(detailKey), fight);
    });
    if (getUsingTestData()) {
      for (const fight of initiallyUncachedFights) {
        fightDetails.set(
          `${report.code}:${fight.id}`,
          attachFightFingerprint(normalizeEmbeddedFightDetails(report, fight), fight),
        );
      }
      return;
    }

    const cacheBatchSize = 4;
    for (let index = 0; index < initiallyUncachedFights.length; index += cacheBatchSize) {
      const cacheBatch = initiallyUncachedFights.slice(index, index + cacheBatchSize);
      await Promise.all(cacheBatch.map(async (fight) => {
        const cachedDetails = await readCachedFightDetails(report.code, fight, { playerActionsOnly });
        if (cachedDetails) fightDetails.set(`${report.code}:${fight.id}`, cachedDetails);
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const uncachedFights = initiallyUncachedFights.filter((fight) => (
      !isReady(fightDetails.get(`${report.code}:${fight.id}`), fight)
    ));
    const abilityIds = [...new Set(getTrackedMitigations().map((entry) => Number(entry.abilityId)))];
    const phaseReferences = getEncounterEventReferences(DANCING_MAD_ENCOUNTER_NAME);
    const requestBatchSize = 3;
    const requestConcurrency = 2;
    const requestWindowSize = requestBatchSize * requestConcurrency;
    for (let index = 0; index < uncachedFights.length; index += requestWindowSize) {
      const requestWindow = uncachedFights.slice(index, index + requestWindowSize);
      const batches = Array.from({ length: requestConcurrency }, (_, batchIndex) => (
        requestWindow.slice(batchIndex * requestBatchSize, (batchIndex + 1) * requestBatchSize)
      )).filter((batch) => batch.length > 0);
      const responses = await Promise.all(batches.map(async (batch) => ({
        batch,
        rawDetails: await fetchFightEventDetails(
          report.code,
          batch.map((fight) => fight.id),
          abilityIds,
          phaseReferences,
        ),
      })));
      for (const { batch, rawDetails } of responses) {
        for (const fight of batch) {
          const cacheRecord = createRawFightDetailsCacheRecord(rawDetails, fight);
          const normalizedDetails = attachFightFingerprint(
            normalizeFightDetails(cacheRecord.rawDetails, fight.id, { playerActionsOnly }),
            fight,
          );
          fightDetails.set(`${report.code}:${fight.id}`, normalizedDetails);
          await writeCachedFightDetails(report.code, fight, cacheRecord);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    }
  }

  return {
    clearReportFightDetailsCache,
    createFightDetailsPanel,
    discardChangedFightDetails,
    ensureReportFightDetails,
    getEventAbilityName,
    getFightDetailsCacheVersion,
    getFightFingerprint,
    reloadFightDetails,
    toggleFightDetails,
    toggleFightMitigations,
  };
}
