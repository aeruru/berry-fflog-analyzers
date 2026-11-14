// Loads, persists, and applies event-table and mitigation-view preferences across rendered trackers.
const MITIGATION_FILTER_STORAGE_KEY = 'berry-mitigation-filter';
const MITIGATION_SLOT_STORAGE_KEY = 'berry-mitigation-slot';
const LEGACY_SHOW_ON_TIME_STORAGE_KEY = 'berry-show-on-time-mitigations';
const DETAILS_VIEW_STORAGE_KEY = 'berry-details-view';
const MITIGATION_FILTER_MODES = new Set(['more-than-one', 'off-time', 'all']);
const DETAILS_VIEW_MODES = new Set(['timeline', 'table']);

export function createUiPreferences(dependencies) {
  const {
    PARTY_SLOT_ORDER,
    applyMitigationResultFilter,
    elements,
    getIsDetailsTableVisible,
    setIsDetailsTableVisible,
    setMitigationFilterModeState,
    setSelectedMitigationSlot,
    updateWithSmoothHeight,
  } = dependencies;

  function loadMitigationFilterMode() {
    try {
      const savedMode = localStorage.getItem(MITIGATION_FILTER_STORAGE_KEY);
      if (MITIGATION_FILTER_MODES.has(savedMode)) return savedMode;
      const legacyValue = localStorage.getItem(LEGACY_SHOW_ON_TIME_STORAGE_KEY);
      if (legacyValue === 'true') return 'all';
      if (legacyValue === 'false') return 'off-time';
    } catch {
      // Fall through to the most focused default when storage is unavailable.
    }
    return 'more-than-one';
  }

  function loadMitigationSlot() {
    try {
      const savedSlot = localStorage.getItem(MITIGATION_SLOT_STORAGE_KEY);
      if (savedSlot === 'all' || PARTY_SLOT_ORDER.includes(savedSlot)) return savedSlot;
    } catch {
      // Fall through to H1 when storage is unavailable.
    }
    return 'H1';
  }

  function loadDetailsTableVisibility() {
    try {
      const savedMode = localStorage.getItem(DETAILS_VIEW_STORAGE_KEY);
      if (DETAILS_VIEW_MODES.has(savedMode)) return savedMode === 'table';
    } catch {
      // Fall through to timeline when storage is unavailable.
    }
    return false;
  }

  function setDetailsTableVisibility(isVisible) {
    const nextValue = Boolean(isVisible);
    setIsDetailsTableVisible(nextValue);
    try {
      localStorage.setItem(DETAILS_VIEW_STORAGE_KEY, nextValue ? 'table' : 'timeline');
    } catch {
      // Keep the preference active for this page when storage is unavailable.
    }
  }

  function renderDetailsViewControl() {
    const isVisible = getIsDetailsTableVisible();
    elements.detailsViewLabel.textContent = `Events table: ${isVisible ? 'On' : 'Off'}`;
    elements.detailsViewControl.title = 'The events timeline will always be shown.';
    elements.detailsViewButton.setAttribute('aria-pressed', String(isVisible));
    elements.detailsViewButton.setAttribute(
      'aria-label',
      `Events table: ${isVisible ? 'on' : 'off'}. The events timeline will always be shown.`,
    );
    elements.detailsViewButton.title = isVisible
      ? 'Hide events table. The events timeline will always be shown.'
      : 'Show events table. The events timeline will always be shown.';
  }

  function setMitigationFilterMode(mode) {
    if (!MITIGATION_FILTER_MODES.has(mode)) return;
    setMitigationFilterModeState(mode);
    try {
      localStorage.setItem(MITIGATION_FILTER_STORAGE_KEY, mode);
      localStorage.removeItem(LEGACY_SHOW_ON_TIME_STORAGE_KEY);
    } catch {
      // Keep the preference active for this page when storage is unavailable.
    }
    document.querySelectorAll('.mitigation-tracker').forEach((tracker) => {
      const select = tracker.querySelector('.mitigation-filter-select');
      if (select) select.value = mode;
      updateWithSmoothHeight(tracker, () => applyMitigationResultFilter(tracker));
    });
  }

  function selectMitigationSlotInTracker(tracker, requestedSlot) {
    const slotSelect = tracker.querySelector('.mitigation-slot-select');
    if (!slotSelect) return;
    const availableSlots = [...slotSelect.options].map((option) => option.value);
    const selectedSlot = availableSlots.includes(requestedSlot) ? requestedSlot : availableSlots[0];
    if (!selectedSlot) return;
    updateWithSmoothHeight(tracker, () => {
      slotSelect.value = selectedSlot;
      for (const tab of tracker.querySelectorAll('.mitigation-tab')) {
        const isSelected = tab.dataset.mitigationSlot === selectedSlot;
        tab.setAttribute('aria-selected', String(isSelected));
        tab.tabIndex = isSelected ? 0 : -1;
      }
      for (const panel of tracker.querySelectorAll('.mitigation-panel')) {
        panel.hidden = panel.dataset.mitigationSlot !== selectedSlot;
      }
    });
  }

  function setMitigationSlot(slot) {
    if (slot !== 'all' && !PARTY_SLOT_ORDER.includes(slot)) return;
    setSelectedMitigationSlot(slot);
    try {
      localStorage.setItem(MITIGATION_SLOT_STORAGE_KEY, slot);
    } catch {
      // Keep the preference active for this page when storage is unavailable.
    }
    document.querySelectorAll('.mitigation-tracker').forEach((tracker) => {
      selectMitigationSlotInTracker(tracker, slot);
    });
  }

  return {
    loadDetailsTableVisibility,
    loadMitigationFilterMode,
    loadMitigationSlot,
    renderDetailsViewControl,
    setDetailsTableVisibility,
    setMitigationFilterMode,
    setMitigationSlot,
  };
}
