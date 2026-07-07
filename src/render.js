import { TARGET_ZONE_ID } from './config.js';
import {
  clamp,
  escapeHtml,
  estimatePhase,
  formatDateRange,
  formatDuration,
  formatEventTime,
  formatFightCount,
  formatPhaseLabel,
  formatShortDate,
  formatTime,
  getFflogsReportUrl,
  renderEventIcon,
} from './format.js';
import { getFightEventKey } from './fight-events.js';

export function renderZoneReports({
  activeFightEventKey,
  elements,
  expandedZoneReportIds,
  fightEventDetails,
  onClearFightCache,
  onClearReportCache,
  onLoadFight,
  onToggleReport,
  zoneReports,
}) {
  const { zoneReportCount, zoneReportList, zoneReportTitle } = elements;
  zoneReportCount.textContent = `${zoneReports.length} ${zoneReports.length === 1 ? 'report' : 'reports'}`;
  const zoneName = zoneReports.find((report) => report.zoneName)?.zoneName;
  zoneReportTitle.textContent = zoneName ? `${zoneName} reports` : `Zone ${TARGET_ZONE_ID} reports`;

  if (zoneReports.length === 0) {
    zoneReportList.innerHTML = `<div class="empty-state">No recent Zone ${TARGET_ZONE_ID} reports found yet.</div>`;
    return;
  }

  zoneReportList.innerHTML = zoneReports.map((report) => {
    const isExpanded = expandedZoneReportIds.has(report.id);
    const fights = [...report.pulls].sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    return `
      <article class="zone-report-card ${isExpanded ? 'expanded' : ''}">
        <div class="zone-report-toggle" data-zone-report-id="${escapeHtml(report.id)}" role="button" tabindex="0" aria-expanded="${isExpanded}">
          <div>
            <h3>${escapeHtml(report.title || report.zoneName)}</h3>
            <p class="meta">${report.reportCode ? `<a class="report-code-link" href="${getFflogsReportUrl(report.reportCode)}" target="_blank" rel="noreferrer">${escapeHtml(report.reportCode)}</a><br>` : ''}${formatDateRange(report.startTime, report.endTime)}</p>
          </div>
          <div class="report-card-actions">
            <button class="cache-clear-button report-cache-clear" data-report-id="${escapeHtml(report.id)}" type="button">Clear cache</button>
            <span class="pill">${formatFightCount(report.pulls.length)}</span>
          </div>
        </div>
        ${isExpanded ? renderZoneFightCards(report, fights, { activeFightEventKey, fightEventDetails }) : ''}
      </article>
    `;
  }).join('');

  zoneReportList.querySelectorAll('.report-code-link').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.stopPropagation();
    });
  });

  zoneReportList.querySelectorAll('.report-cache-clear').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onClearReportCache(button.dataset.reportId);
    });
  });

  zoneReportList.querySelectorAll('.zone-report-toggle').forEach((toggle) => {
    const toggleReport = () => onToggleReport(toggle.dataset.zoneReportId);

    toggle.addEventListener('click', toggleReport);
    toggle.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleReport();
      }
    });
  });

  zoneReportList.querySelectorAll('.zone-fight-card').forEach((card) => {
    card.addEventListener('click', () => {
      onLoadFight(card.dataset.reportId, card.dataset.fightId);
    });
  });

  zoneReportList.querySelectorAll('.fight-cache-clear').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onClearFightCache(button.dataset.reportId, button.dataset.fightId);
    });
  });
}

function renderZoneFightCards(report, fights, { activeFightEventKey, fightEventDetails }) {
  if (fights.length === 0) {
    return `<div class="zone-fight-list"><div class="empty-state">${report.hydrationError ? `Fight details unavailable: ${escapeHtml(report.hydrationError)}` : 'This report does not include fight data yet.'}</div></div>`;
  }

  return `
    <div class="zone-fight-list">
      ${fights.map((fight, index) => {
        const progress = fight.kill ? 100 : clamp(100 - fight.bossPercent, 0, 100);
        const phase = fight.kill ? 'Clear' : formatPhaseLabel(estimatePhase(progress));
        const bossRemaining = fight.kill ? 0 : clamp(fight.bossPercent, 0, 100);
        const bossLabel = `${bossRemaining.toFixed(1)}% boss remaining`;
        const fightName = fight.name || report.zoneName || `Fight ${index + 1}`;
        const eventKey = getFightEventKey(report, fight);
        const eventState = fightEventDetails.get(eventKey);
        const isActive = eventKey === activeFightEventKey;

        return `
          <article class="zone-fight-card ${isActive ? 'active' : ''}" data-report-id="${escapeHtml(report.id)}" data-fight-id="${escapeHtml(fight.id)}">
            <div class="pull-top">
              <h4>${escapeHtml(`${fight.id} - ${fightName}: ${phase}`)}</h4>
              <button class="cache-clear-button fight-cache-clear" data-report-id="${escapeHtml(report.id)}" data-fight-id="${escapeHtml(fight.id)}" type="button">Clear cache</button>
            </div>
            <div class="pull-meta">
              <span>${formatTime(fight.startTime)}</span>
              <span>${formatDuration(fight.durationSeconds)}</span>
            </div>
            <div class="boss-remaining">
              <div class="boss-remaining-label">
                <span>Boss remaining</span>
                <strong>${bossLabel}</strong>
              </div>
              <div class="boss-remaining-track" aria-label="${bossLabel}">
                <div class="boss-remaining-fill" style="width: ${bossRemaining}%"></div>
              </div>
            </div>
            ${isActive ? renderFightEventDetails(eventState) : ''}
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function renderFightEventDetails(eventState) {
  if (!eventState || eventState.status === 'loading') {
    return `<div class="fight-events-panel"><div class="empty-state">Loading death and damage down events...</div></div>`;
  }

  if (eventState.status === 'error') {
    return `<div class="fight-events-panel"><div class="empty-state">Could not load fight events: ${escapeHtml(eventState.error)}</div></div>`;
  }

  if (eventState.events.length === 0) {
    return `<div class="fight-events-panel"><div class="empty-state">No death or damage down events found for this fight.</div></div>`;
  }

  return `
    <div class="fight-events-panel">
      <div class="fight-events-summary">${eventState.players.length} players in report</div>
      <table class="fight-events-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Player</th>
            <th>Event</th>
          </tr>
        </thead>
        <tbody>
          ${eventState.events.map((event) => `
            <tr>
              <td>${escapeHtml(formatEventTime(event.timestampMs))}</td>
              <td>${escapeHtml(event.playerName)}</td>
              <td class="event-icon">${renderEventIcon(event.kind)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

export function renderReportGraph({
  elements,
  onSelectSession,
  selectedSessionId,
  sessions,
}) {
  const { reportGraph, reportGraphCount } = elements;
  reportGraphCount.textContent = `${sessions.length} ${sessions.length === 1 ? 'report' : 'reports'}`;

  if (sessions.length === 0) {
    reportGraph.innerHTML = `<div class="empty-state">Log in to graph your latest FFLogs reports, or use local test data.</div>`;
    return;
  }

  const maxPulls = Math.max(...sessions.map((session) => session.pulls.length), 1);
  reportGraph.innerHTML = sessions.map((session) => {
    const width = Math.max(8, Math.round((session.pulls.length / maxPulls) * 100));
    const isActive = session.id === selectedSessionId;

    return `
      <button class="report-bar ${isActive ? 'active' : ''}" data-session-id="${escapeHtml(session.id)}" type="button">
        <div>
          <h3>${escapeHtml(session.zoneName)}</h3>
          <p class="meta">${session.title ? `${escapeHtml(session.title)}<br>` : ''}${formatShortDate(session.startTime)}</p>
        </div>
        <div class="bar-track" aria-hidden="true">
          <div class="bar-fill" style="width: ${width}%"></div>
        </div>
        <span class="pill">${session.pulls.length} pulls</span>
      </button>
    `;
  }).join('');

  reportGraph.querySelectorAll('.report-bar').forEach((bar) => {
    bar.addEventListener('click', () => {
      onSelectSession(bar.dataset.sessionId);
    });
  });
}
