// Coordinates report startup, refresh, test-data switching, searching, selection, and compact report rendering.
export function createReportController(dependencies) {
  const {
    CHECK_PULLS_TOOLTIP,
    CHECK_REPORTS_TOOLTIP,
    RELOAD_PULLS_TOOLTIP,
    RELOAD_REPORTS_TOOLTIP,
    addTestMitigationCasts,
    clearReportFightDetailsCache,
    clearSpecialHardcodedViewState,
    completeFflogsLogin,
    createBestPullBadge,
    createGroupingScenarioReport,
    createOneEventPageReport,
    discardChangedFightDetails,
    elements,
    fetchCurrentFflogsUser,
    fetchReportByCode,
    fetchWeeklyReports,
    getCurrentUser,
    getDancingMadMitigations,
    getBestDmuPull,
    getIsRefreshingWeeklyReports,
    getIsShiftHeld,
    getReports,
    getSelectedReport,
    getUsingTestData,
    isDmuPull,
    isLoggedInToFflogs,
    loadDancingMadMechanics,
    loadDancingMadLilyUsages,
    loadDancingMadMitigations,
    loadEncounterPhaseDefinitions,
    loadMitigationAbilities,
    loadMitigationCooldowns,
    materializePaginatedTestReport,
    mitigationHistoryPromises,
    parseFflogsReportCode,
    renderAccount,
    renderLookupResult,
    setBusy,
    setCurrentUser,
    setFightDetails,
    setIsRefreshingWeeklyReports,
    setIsShiftHeld,
    setLookupStatus,
    setOpenFightDetailKeys,
    setOpenFightMitigationKeys,
    setReports,
    setReportsStatus,
    setSelectedReport,
    setStatus,
    setUsingTestData,
  } = dependencies;

  async function initialize() {
    setBusy(true);
    try {
      await loadEncounterPhaseDefinitions();
      await loadDancingMadMechanics();
      await loadDancingMadLilyUsages();
      await loadMitigationAbilities();
      await loadDancingMadMitigations();
      await loadMitigationCooldowns();
      const token = await completeFflogsLogin();
      if (token) setStatus('FFLogs login complete. Loading your account...');
      if (isLoggedInToFflogs()) {
        const currentUser = await fetchCurrentFflogsUser();
        setCurrentUser(currentUser);
        setStatus('Loading your reports...');
        setReportsStatus('Loading every nonempty report from the last week...');
        const reports = await fetchWeeklyReports(currentUser.id);
        setReports(reports);
        setStatus('Ready to query FFLogs.');
        setReportsStatus(formatLoadedReportsStatus(reports.length));
      }
    } catch (error) {
      setStatus(error.message, true);
      setReportsStatus('Reports could not be loaded.', true);
    } finally {
      setBusy(false);
      renderAccount();
      renderReports();
    }
  }

  function renderReports() {
    const reports = getReports();
    const usingTestData = getUsingTestData();
    elements.reportCount.textContent = `${reports.length} ${reports.length === 1 ? 'report' : 'reports'}`;
    elements.reportsList.replaceChildren(...reports.map(createReportCard));
    elements.testDataButton.textContent = usingTestData ? 'Use live data' : 'Use test data';
    elements.refreshReportsButton.disabled = usingTestData || !getCurrentUser() || !isLoggedInToFflogs();
    elements.recentReportCodes.replaceChildren(...reports.map((report) => {
      const option = document.createElement('option');
      option.value = report.code;
      return option;
    }));
  }

  function updateRefreshReportsButton(shiftHeld) {
    if (getIsRefreshingWeeklyReports()) return;
    const label = shiftHeld ? 'Reload all reports' : 'Check for new reports';
    const tooltip = shiftHeld ? RELOAD_REPORTS_TOOLTIP : CHECK_REPORTS_TOOLTIP;
    elements.refreshReportsButton.textContent = label;
    elements.refreshReportsButton.title = tooltip;
    elements.refreshReportsButton.setAttribute('aria-label', `${label}. ${tooltip}`);
  }

  function updateShiftSensitiveButtons(nextShiftState) {
    setIsShiftHeld(nextShiftState);
    updateRefreshReportsButton(nextShiftState);
    document.querySelectorAll('.report-reload-button').forEach((button) => {
      updateSelectedReportReloadButton(button, nextShiftState);
    });
  }

  function updateSelectedReportReloadButton(button, shiftHeld) {
    if (button.disabled) return;
    const label = shiftHeld ? 'Reload report' : 'Check for new pulls';
    const tooltip = shiftHeld ? RELOAD_PULLS_TOOLTIP : CHECK_PULLS_TOOLTIP;
    button.textContent = label;
    button.title = tooltip;
    button.setAttribute('aria-label', `${label}. ${tooltip}`);
  }

  async function refreshWeeklyReports(event) {
    const currentUser = getCurrentUser();
    if (getUsingTestData() || !currentUser || !isLoggedInToFflogs()) return;
    const reloadAllReports = event.shiftKey;
    const reports = getReports();
    const previousCodes = new Set(reports.map((report) => report.code));
    setIsRefreshingWeeklyReports(true);
    elements.refreshReportsButton.disabled = true;
    elements.refreshReportsButton.textContent = reloadAllReports ? 'Reloading…' : 'Checking…';
    setReportsStatus(reloadAllReports
      ? 'Reloading every report from FFLogs...'
      : 'Checking FFLogs for new reports...');
    try {
      if (reloadAllReports) clearSpecialHardcodedViewState();
      const refreshedReports = await fetchWeeklyReports(currentUser.id, {
        cachedReports: reloadAllReports ? [] : reports,
      });
      const newReportCount = refreshedReports.filter((report) => !previousCodes.has(report.code)).length;
      setReports(refreshedReports);
      renderReports();
      setReportsStatus(newReportCount > 0
        ? `Found ${newReportCount} new ${newReportCount === 1 ? 'report' : 'reports'}.`
        : formatLoadedReportsStatus(refreshedReports.length));
    } catch (error) {
      setReportsStatus(error.message, true);
    } finally {
      setIsRefreshingWeeklyReports(false);
      elements.refreshReportsButton.disabled = false;
      updateRefreshReportsButton(false);
    }
  }

  async function toggleTestData() {
    elements.testDataButton.disabled = true;
    try {
      if (!getUsingTestData()) {
        setReportsStatus('Loading local test report data...');
        const response = await fetch('./test-data/reports.json');
        if (!response.ok) throw new Error(`Test report data returned ${response.status}.`);
        const payload = await response.json();
        const localReports = await Promise.all(payload.reports.map(loadExternalTestFightDetails));
        const testReports = await Promise.all([
          ...localReports,
          createGroupingScenarioReport(),
          createOneEventPageReport(getDancingMadMitigations()),
        ].map(materializePaginatedTestReport));
        setReports(testReports
          .filter((report) => report?.fights?.length > 0)
          .map((report, reportIndex) => addTestMitigationCasts(report, payload.actors ?? [], reportIndex)));
        resetSelectedReportForDataSourceChange();
        setUsingTestData(true);
        setReportsStatus('Using local test report data.');
        return;
      }

      setUsingTestData(false);
      const currentUser = getCurrentUser();
      if (!isLoggedInToFflogs() || !currentUser) {
        setReports([]);
        resetSelectedReportForDataSourceChange();
        setReportsStatus('Log in to load reports.');
        return;
      }
      setReportsStatus('Restoring live reports...');
      const reports = await fetchWeeklyReports(currentUser.id);
      setReports(reports);
      resetSelectedReportForDataSourceChange();
      setReportsStatus(formatLoadedReportsStatus(reports.length));
    } catch (error) {
      setReportsStatus(error.message, true);
    } finally {
      elements.testDataButton.disabled = false;
      renderReports();
    }
  }

  function resetSelectedReportForDataSourceChange() {
    setSelectedReport(null);
    setFightDetails(new Map());
    setOpenFightDetailKeys(new Set());
    setOpenFightMitigationKeys(new Set());
    mitigationHistoryPromises.clear();
    clearSpecialHardcodedViewState();
    elements.reportSearchInput.value = '';
    elements.lookupResult.replaceChildren();
    setLookupStatus('Choose a report from this data source.');
  }

  async function loadExternalTestFightDetails(report) {
    if (!report.fightDetailsFile) return report;
    const response = await fetch(report.fightDetailsFile);
    if (!response.ok) throw new Error(`Test fight details returned ${response.status}.`);
    const fixture = await response.json();
    if (fixture.reportCode !== report.code) {
      throw new Error(`Test fight details belong to ${fixture.reportCode}, not ${report.code}.`);
    }
    return {
      ...report,
      fights: report.fights.map((fight) => ({
        ...fight,
        cachedDetails: fixture.fights?.[String(fight.id)] ?? null,
      })),
    };
  }

  async function searchForReport(event) {
    event.preventDefault();
    const reportCode = parseFflogsReportCode(elements.reportSearchInput.value);
    if (!reportCode) {
      elements.reportSearchInput.setAttribute('aria-invalid', 'true');
      setLookupStatus('Enter a report code or a valid https://www.fflogs.com/reports/ URL.', true);
      return;
    }
    elements.reportSearchInput.removeAttribute('aria-invalid');
    const knownReport = getReports().find((report) => report.code === reportCode);
    if (knownReport) {
      loadKnownReport(knownReport);
      return;
    }
    if (getUsingTestData()) {
      setLookupStatus(`Test data does not include report ${reportCode}.`, true);
      return;
    }
    if (!isLoggedInToFflogs()) {
      setLookupStatus('Log in to FFLogs before loading a report.', true);
      return;
    }
    elements.loadReportButton.disabled = true;
    elements.reportSearchInput.disabled = true;
    setLookupStatus(`Loading report ${reportCode}...`);
    try {
      const selectedReport = await fetchReportByCode(reportCode);
      if (!selectedReport) throw new Error(`FFLogs could not find report ${reportCode}.`);
      setSelectedReport(selectedReport);
      setOpenFightDetailKeys(new Set());
      setOpenFightMitigationKeys(new Set());
      renderLookupResult();
      setLookupStatus(`Loaded report ${reportCode}.`);
    } catch (error) {
      setSelectedReport(null);
      renderLookupResult();
      setLookupStatus(error.message, true);
    } finally {
      elements.loadReportButton.disabled = false;
      elements.reportSearchInput.disabled = false;
    }
  }

  function loadKnownReport(report) {
    setSelectedReport(report);
    setOpenFightDetailKeys(new Set());
    setOpenFightMitigationKeys(new Set());
    elements.reportSearchInput.value = report.code;
    elements.reportSearchInput.removeAttribute('aria-invalid');
    renderLookupResult();
    setLookupStatus(`Loaded report ${report.code}.`);
  }

  async function reloadSelectedReport(button, reloadAllPulls) {
    const selectedReport = getSelectedReport();
    if (!selectedReport) return;
    button.disabled = true;
    button.textContent = reloadAllPulls ? 'Reloading…' : 'Checking…';
    const reportCode = selectedReport.code;
    if (reloadAllPulls) clearSpecialHardcodedViewState(reportCode);
    setLookupStatus(reloadAllPulls
      ? `Reloading every pull in report ${reportCode}...`
      : `Checking report ${reportCode} for new pulls...`);
    try {
      let refreshedReport;
      if (getUsingTestData()) {
        refreshedReport = getReports().find((report) => report.code === reportCode) ?? selectedReport;
      } else {
        refreshedReport = await fetchReportByCode(reportCode);
        if (!refreshedReport) throw new Error(`FFLogs could not find report ${reportCode}.`);
        setReports(getReports().map((report) => report.code === reportCode ? refreshedReport : report));
        renderReports();
      }
      setSelectedReport(refreshedReport);
      if (reloadAllPulls) await clearReportFightDetailsCache(reportCode);
      else discardChangedFightDetails(refreshedReport);
      setOpenFightDetailKeys(new Set());
      setOpenFightMitigationKeys(new Set());
      renderLookupResult();
      setLookupStatus(reloadAllPulls
        ? `Reloaded report ${reportCode}. Pull details will be fetched again when opened.`
        : `Checked report ${reportCode} for new pulls.`);
    } catch (error) {
      setLookupStatus(error.message, true);
      button.disabled = false;
      updateSelectedReportReloadButton(button, getIsShiftHeld());
    }
  }

  function createReportCard(report) {
    const dmuPulls = report.fights.filter(isDmuPull);
    const article = document.createElement('article');
    article.className = 'report-card';
    article.tabIndex = 0;
    article.setAttribute('aria-label', `Load report ${report.code}`);
    article.addEventListener('click', (event) => {
      if (!event.target.closest('a')) loadKnownReport(report);
    });
    article.addEventListener('keydown', (event) => {
      if (event.target === article && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        loadKnownReport(report);
      }
    });
    const identity = document.createElement('div');
    identity.className = 'report-identity';
    const title = document.createElement('strong');
    title.textContent = report.title || 'Untitled report';
    identity.append(title);
    const codeLink = document.createElement('a');
    codeLink.className = 'report-code';
    codeLink.href = `https://www.fflogs.com/reports/${encodeURIComponent(report.code)}`;
    codeLink.target = '_blank';
    codeLink.rel = 'noreferrer';
    codeLink.textContent = report.code;
    const date = document.createElement('time');
    date.className = 'report-date';
    date.dateTime = new Date(report.startTime).toISOString();
    date.textContent = new Intl.DateTimeFormat(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(new Date(report.startTime));
    const pullCount = document.createElement('div');
    pullCount.className = 'report-pull-summary';
    const dmuLabel = document.createElement('span');
    dmuLabel.textContent = 'DMU';
    const pullCountValue = document.createElement('strong');
    pullCountValue.textContent = String(dmuPulls.length);
    pullCount.append(dmuLabel, ': ', pullCountValue, ` ${dmuPulls.length === 1 ? 'pull' : 'pulls'}`);
    const best = document.createElement('div');
    best.className = 'report-metric report-best-pull';
    best.append(createBestPullBadge(getBestDmuPull(dmuPulls)));
    article.append(identity, codeLink, pullCount, date, best);
    return article;
  }

  function formatLoadedReportsStatus(count) {
    return `Loaded ${count} nonempty ${count === 1 ? 'report' : 'reports'} from the last 7 days.`;
  }

  return {
    initialize,
    refreshWeeklyReports,
    reloadSelectedReport,
    renderReports,
    searchForReport,
    toggleTestData,
    updateRefreshReportsButton,
    updateSelectedReportReloadButton,
    updateShiftSensitiveButtons,
  };
}
