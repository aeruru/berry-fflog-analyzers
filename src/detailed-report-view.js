// Builds the selected report view, including fight filtering, fight cards, and panel controls.
export function createDetailedReportViewModule(dependencies) {
  const {
    createBestPullBadge,
    createExternalLink,
    createFightDetailsPanel,
    createFightMitigationPanel,
    createLinkGroup,
    formatFightDuration,
    formatFightStartTime,
    formatReportDateRange,
    getBestDmuPull,
    getFightDetails,
    getFightDuration,
    getIsShiftHeld,
    getOpenFightDetailKeys,
    getOpenFightMitigationKeys,
    getPullColorClass,
    getSelectedReportPhase,
    isDmuPull,
    normalizeBossHealth,
    reloadFightDetails,
    reloadSelectedReport,
    renderLookupResult,
    setSelectedReportPhase,
    showReportMitigationHistoryOverview,
    showReportPlayerActionsOverview,
    showSpecialHardcodedViews,
    toggleFightDetails,
    toggleFightMitigations,
    updateSelectedReportReloadButton,
  } = dependencies;

  function createDetailedReportView(report) {
    const article = document.createElement('article');
    article.className = 'detailed-report-card';
  
    const fights = report.fights.filter(isDmuPull)
      .sort((first, second) => Number(second.startTime) - Number(first.startTime));
    const visibleFights = filterReportFightsByOutcome(fights, getSelectedReportPhase());
    const highlightedFight = getBestDmuPull(visibleFights);
  
    const summary = document.createElement('div');
    summary.className = 'detailed-report-summary';
  
    const info = document.createElement('div');
    info.className = 'detailed-report-info';
    const title = document.createElement('h3');
    title.textContent = report.title || report.zone?.name || 'Untitled report';
    const codeLink = document.createElement('a');
    codeLink.className = 'report-code-link';
    codeLink.href = `https://www.fflogs.com/reports/${encodeURIComponent(report.code)}`;
    codeLink.target = '_blank';
    codeLink.rel = 'noreferrer';
    codeLink.textContent = report.code;
    const dateRange = document.createElement('p');
    dateRange.className = 'detailed-report-dates';
    dateRange.textContent = formatReportDateRange(report.startTime, report.endTime);
    info.append(title, codeLink, dateRange);
  
    const actions = document.createElement('div');
    actions.className = 'detailed-report-actions';
    const reloadButton = document.createElement('button');
    reloadButton.className = 'report-reload-button';
    reloadButton.type = 'button';
    updateSelectedReportReloadButton(reloadButton, getIsShiftHeld());
    reloadButton.addEventListener('click', (event) => reloadSelectedReport(reloadButton, event.shiftKey));
    const phaseFilter = document.createElement('select');
    phaseFilter.className = 'report-phase-select';
    phaseFilter.setAttribute('aria-label', 'Filter fights by phase');
    phaseFilter.append(new Option('All pulls', 'all'));
    phaseFilter.append(new Option('Clears', 'clears'));
    for (let phase = 1; phase <= 5; phase += 1) {
      phaseFilter.append(new Option(`Phase ${phase} wipes`, String(phase)));
    }
    phaseFilter.value = getSelectedReportPhase();
    phaseFilter.addEventListener('change', () => {
      setSelectedReportPhase(phaseFilter.value);
      renderLookupResult();
    });
  
    const mitigationOverviewButton = document.createElement('button');
    mitigationOverviewButton.className = 'report-mitigation-overview-button';
    mitigationOverviewButton.type = 'button';
    mitigationOverviewButton.textContent = 'View all mit graphs';
    mitigationOverviewButton.addEventListener('click', () => {
      showReportMitigationHistoryOverview(report, mitigationOverviewButton);
    });
  
    const playerActionsButton = document.createElement('button');
    playerActionsButton.className = 'report-player-actions-button';
    playerActionsButton.type = 'button';
    playerActionsButton.textContent = 'View player actions';
    playerActionsButton.addEventListener('click', () => {
      showReportPlayerActionsOverview(report, playerActionsButton);
    });
  
    const specialViewsButton = document.createElement('button');
    specialViewsButton.className = 'report-special-views-button';
    specialViewsButton.type = 'button';
    specialViewsButton.textContent = 'Special hardcoded views';
    specialViewsButton.addEventListener('click', () => {
      showSpecialHardcodedViews(report, specialViewsButton);
    });
  
    const fightCount = document.createElement('span');
    fightCount.className = 'fight-count-pill';
    fightCount.textContent = formatFilteredFightCount(visibleFights.length, getSelectedReportPhase());
    const pullSummary = document.createElement('div');
    pullSummary.className = 'detailed-report-pull-summary';
    const emptyPullLabel = getSelectedReportPhase() === 'all'
      ? 'No DMU pulls'
      : getSelectedReportPhase() === 'clears'
        ? 'No clears'
        : `No P${getSelectedReportPhase()} wipes`;
    pullSummary.append(fightCount, createBestPullBadge(highlightedFight, emptyPullLabel));
    actions.append(
      reloadButton,
      phaseFilter,
      mitigationOverviewButton,
      playerActionsButton,
      specialViewsButton,
      pullSummary,
    );
    summary.append(info, actions);
  
    const fightList = document.createElement('div');
    fightList.className = 'detailed-fight-list';
    if (visibleFights.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'detailed-empty-state';
      empty.textContent = getSelectedReportPhase() === 'all'
        ? 'This report does not include DMU fight data.'
        : getSelectedReportPhase() === 'clears'
          ? 'No clears found in this report.'
          : `No wipes ended during Phase ${getSelectedReportPhase()} in this report.`;
      fightList.append(empty);
    } else {
      fightList.append(...visibleFights.map((fight) => createDetailedFightCard(report, fight, highlightedFight)));
    }
  
    article.append(summary, fightList);
    return article;
  }
  
  // Numbered phases are wipe locations, while successful kills have their own filter.
  // Keeping those outcomes disjoint prevents a clear from also appearing as a P5 wipe.
  function filterReportFightsByOutcome(fights, filter) {
    if (filter === 'all') return fights;
    if (filter === 'clears') return fights.filter((fight) => fight.kill);
    return fights.filter((fight) => !fight.kill
      && String(Number(fight.lastPhase) || 1) === filter);
  }
  
  function formatFilteredFightCount(count, filter) {
    if (filter === 'clears') return `${count} ${count === 1 ? 'clear' : 'clears'}`;
    if (filter !== 'all') return `${count} P${filter} ${count === 1 ? 'wipe' : 'wipes'}`;
    return `${count} ${count === 1 ? 'pull' : 'pulls'}`;
  }
  
  // Each fight card owns only summary UI. The details and mitigation panels have
  // independent expansion state while sharing fetched event data for the same fight.
  function createDetailedFightCard(report, fight, highlightedFight) {
    const bossRemaining = fight.kill ? 0 : normalizeBossHealth(fight);
    const bossDamageDone = Math.min(100, Math.max(0, 100 - bossRemaining));
    const isHighlighted = fight === highlightedFight;
    const card = document.createElement('article');
    card.className = `detailed-fight-card${isHighlighted ? ' highlighted' : ''}`;
  
    const top = document.createElement('div');
    top.className = 'detailed-fight-top';
    const titleRow = document.createElement('div');
    titleRow.className = 'detailed-fight-title';
    const phaseTag = document.createElement('span');
    phaseTag.className = `detailed-phase-tag ${getPullColorClass(fight)}`;
    phaseTag.textContent = fight.kill ? 'CLR' : fight.lastPhaseIsIntermission
      ? `I${Number(fight.lastPhase) || 1}`
      : `P${Number(fight.lastPhase) || 1}`;
    const heading = document.createElement('h4');
    const phaseName = fight.kill ? 'Clear' : fight.lastPhaseIsIntermission
      ? `Intermission ${Number(fight.lastPhase) || 1}`
      : `Phase ${Number(fight.lastPhase) || 1}`;
    heading.textContent = `${fight.id} - ${fight.name || 'Dancing Mad'}: ${phaseName}`;
    titleRow.append(phaseTag, heading);
  
    const links = document.createElement('div');
    links.className = 'detailed-fight-links';
    const detailKey = `${report.code}:${fight.id}`;
    const detailsOpen = getOpenFightDetailKeys().has(detailKey);
    const mitigationsOpen = getOpenFightMitigationKeys().has(detailKey);
    const detailsButton = document.createElement('button');
    detailsButton.className = 'fight-details-button';
    detailsButton.type = 'button';
    detailsButton.textContent = detailsOpen ? 'Hide DD/death events' : 'Show DD/death events';
    detailsButton.setAttribute('aria-expanded', String(detailsOpen));
    detailsButton.addEventListener('click', () => toggleFightDetails(report, fight));
    const mitigationsButton = document.createElement('button');
    mitigationsButton.className = 'fight-details-button';
    mitigationsButton.type = 'button';
    mitigationsButton.textContent = mitigationsOpen ? 'Hide mits' : 'Show mits';
    mitigationsButton.setAttribute('aria-expanded', String(mitigationsOpen));
    mitigationsButton.addEventListener('click', () => toggleFightMitigations(report, fight));
    const reloadPullButton = document.createElement('button');
    reloadPullButton.className = 'report-mitigation-overview-button fight-pull-reload-button';
    reloadPullButton.type = 'button';
    reloadPullButton.textContent = 'Reload pull';
    reloadPullButton.title = 'Discard and refetch cached details for only this pull.';
    reloadPullButton.addEventListener('click', () => {
      void reloadFightDetails(report, fight, reloadPullButton);
    });
    const fflogsLink = document.createElement('a');
    fflogsLink.href = `https://www.fflogs.com/reports/${encodeURIComponent(report.code)}?fight=${encodeURIComponent(fight.id)}`;
    fflogsLink.target = '_blank';
    fflogsLink.rel = 'noreferrer';
    fflogsLink.textContent = 'FFLogs';
    links.append(detailsButton, mitigationsButton, reloadPullButton, fflogsLink);
    const analyzerLinks = document.createElement('div');
    analyzerLinks.className = 'detailed-fight-analyzer-links';
    const durationMs = getFightDuration(fight);
    let analyzerItems = [];
    if (detailsOpen && !fight.kill && !fight.lastPhaseIsIntermission && durationMs > 150_000) {
      const arrowsLink = createExternalLink(
        '🔃',
        `https://analyzer.wtfdig.info/arrows?report=${encodeURIComponent(report.code)}&fight=${encodeURIComponent(fight.id)}`,
      );
      arrowsLink.className = 'analyzer-icon-link';
      arrowsLink.setAttribute('aria-label', 'Arrows analyzer');
      arrowsLink.title = 'Arrows analyzer';
      analyzerItems.push(arrowsLink);
    }
    if (detailsOpen && !fight.kill && !fight.lastPhaseIsIntermission && Number(fight.lastPhase) >= 2) {
      const forsakenLink = createExternalLink(
        'FT',
        `https://analyzer.wtfdig.info/forsaken?report=${encodeURIComponent(report.code)}&fight=${encodeURIComponent(fight.id)}`,
      );
      forsakenLink.setAttribute('aria-label', 'Forsaken analyzer');
      forsakenLink.title = 'Forsaken analyzer';
      analyzerItems.push(forsakenLink);
    }
    if (detailsOpen && !fight.kill && !fight.lastPhaseIsIntermission && durationMs > 525_000) {
      const limitCutLink = createExternalLink(
          'LC',
          `https://analyzer.wtfdig.info/kefka-lc?report=${encodeURIComponent(report.code)}&fight=${encodeURIComponent(fight.id)}`,
      );
      limitCutLink.setAttribute('aria-label', 'Limit Cut analyzer');
      limitCutLink.title = 'Limit Cut analyzer';
      analyzerItems.push(limitCutLink);
    }
    if (detailsOpen && !fight.kill && !fight.lastPhaseIsIntermission && durationMs > 580_000) {
      const blackHoleLink = createExternalLink(
          'BH',
          `https://analyzer.wtfdig.info/black-hole?report=${encodeURIComponent(report.code)}&fight=${encodeURIComponent(fight.id)}`,
      );
      blackHoleLink.setAttribute('aria-label', 'Black Hole analyzer');
      blackHoleLink.title = 'Black Hole analyzer';
      analyzerItems.push(blackHoleLink);
    }
    if (analyzerItems.length > 0) {
      analyzerLinks.append(createLinkGroup('Analyzers:', analyzerItems));
    }
    analyzerItems = [];
    if (detailsOpen && !fight.kill && !fight.lastPhaseIsIntermission && durationMs > 197_000) {
      const startOffset = Number(fight.startTime);
      const P1dpsLink = createExternalLink(
          'P1',
          `https://www.fflogs.com/reports/${encodeURIComponent(report.code)}?fight=${encodeURIComponent(fight.id)}&type=damage-done&start=${startOffset + 1_000}&end=${startOffset + 198_000}`,
      );
      P1dpsLink.setAttribute('aria-label', 'P1 DPS (0:00-3:10)');
      P1dpsLink.title = 'P1 DPS';
      analyzerItems.push(P1dpsLink);
    }
    if (detailsOpen && !fight.kill && !fight.lastPhaseIsIntermission && durationMs > 331_000) {
      const startOffset = Number(fight.startTime);
      const FTdpsLink = createExternalLink(
        'FT',
        `https://www.fflogs.com/reports/${encodeURIComponent(report.code)}?fight=${encodeURIComponent(fight.id)}&type=damage-done&start=${startOffset + 211_000}&end=${startOffset + 331_000}`,
      );
      FTdpsLink.setAttribute('aria-label', 'Forsaken DPS (3:30-5:30)');
      FTdpsLink.title = 'Forsaken DPS';
      analyzerItems.push(FTdpsLink);
    }
    if (detailsOpen && !fight.kill && !fight.lastPhaseIsIntermission && durationMs > 381_000) {
      const startOffset = Number(fight.startTime);
      const P2dpsLink = createExternalLink(
          'P2',
          `https://www.fflogs.com/reports/${encodeURIComponent(report.code)}?fight=${encodeURIComponent(fight.id)}&type=damage-done&start=${startOffset + 211_000}&end=${startOffset + 381_000}`,
      );
      P2dpsLink.setAttribute('aria-label', 'P2 DPS (3:30-6:20)');
      P2dpsLink.title = 'P2 DPS';
      analyzerItems.push(P2dpsLink);
    }
    if (detailsOpen && !fight.kill && !fight.lastPhaseIsIntermission && durationMs > 735_000) {
      const startOffset = Number(fight.startTime);
      const P3dpsLink = createExternalLink(
          'P3',
          `https://www.fflogs.com/reports/${encodeURIComponent(report.code)}?fight=${encodeURIComponent(fight.id)}&type=damage-done&start=${startOffset + 428_000}&end=${startOffset + 736_000}`,
      );
      P3dpsLink.setAttribute('aria-label', 'P3 DPS (7:07-12:20)');
      P3dpsLink.title = 'P3 DPS';
      analyzerItems.push(P3dpsLink);
    }
    if (analyzerItems.length > 0) {
      analyzerLinks.append(createLinkGroup('DPS:', analyzerItems));
    }
    top.append(titleRow, links);
  
    const meta = document.createElement('div');
    meta.className = 'detailed-fight-meta';
    const start = document.createElement('span');
    start.textContent = formatFightStartTime(report.startTime, fight.startTime);
    const duration = document.createElement('span');
    duration.textContent = formatFightDuration(getFightDuration(fight));
    const health = document.createElement('strong');
    health.className = isHighlighted ? 'highlighted' : '';
    health.textContent = `${bossRemaining.toFixed(1)}% remaining`;
    meta.append(start, duration);
    if (isHighlighted) {
      const bestPullBadge = document.createElement('span');
      bestPullBadge.className = 'fight-best-pull-badge';
      bestPullBadge.tabIndex = 0;
      bestPullBadge.setAttribute('role', 'img');
      bestPullBadge.setAttribute('aria-label', 'Best Pull');
      const bestPullIcon = document.createElement('span');
      bestPullIcon.className = 'fight-best-pull-icon';
      bestPullIcon.setAttribute('aria-hidden', 'true');
      bestPullIcon.textContent = '★';
      const bestPullLabel = document.createElement('span');
      bestPullLabel.className = 'fight-best-pull-label';
      bestPullLabel.setAttribute('aria-hidden', 'true');
      bestPullLabel.textContent = 'Best Pull';
      bestPullBadge.append(bestPullIcon, bestPullLabel);
      meta.append(bestPullBadge);
    }
    meta.append(health);
  
    const bar = document.createElement('div');
    bar.className = `boss-health-bar${isHighlighted ? ' highlighted' : ''}`;
    const fill = document.createElement('div');
    fill.style.width = `${bossDamageDone}%`;
    bar.append(fill);
    card.append(top, meta, bar);
    if (analyzerLinks.childElementCount > 0) {
      card.append(analyzerLinks);
    }
    const detailsPanel = detailsOpen ? createFightDetailsPanel(fight, getFightDetails().get(detailKey)) : null;
    const mitigationPanel = mitigationsOpen ? createFightMitigationPanel(report, fight, getFightDetails().get(detailKey)) : null;
    if (detailsPanel && mitigationPanel) {
      const panels = document.createElement('div');
      panels.className = 'fight-panels';
      panels.append(detailsPanel, mitigationPanel);
      card.append(panels);
    } else if (detailsPanel) {
      card.append(detailsPanel);
    } else if (mitigationPanel) {
      card.append(mitigationPanel);
    }
    return card;
  }
  
  // Reloading replaces the selected report's fight snapshot while retaining event details
  // whose fight fingerprints are unchanged. New or extended pulls are fetched on demand.
  

  return {
    createDetailedReportView,
    filterReportFightsByOutcome,
  };
}
