import { getFflogsAccessToken } from './auth.js';
import {
  FFLOGS_GRAPHQL_ENDPOINT,
  REPORT_LOOKBACK_DAYS,
  REPORT_PAGE_SIZE,
} from './config.js';

const REPORT_LIST_QUERY = `
  query WeeklyReports(
    $userId: Int!
    $startTime: Float!
    $endTime: Float!
    $limit: Int!
    $page: Int!
  ) {
    reportData {
      reports(
        userID: $userId
        startTime: $startTime
        endTime: $endTime
        limit: $limit
        page: $page
      ) {
        current_page
        last_page
        has_more_pages
        data {
          code
          title
          startTime
          endTime
          zone {
            id
            name
          }
        }
      }
    }
  }
`;

const REPORT_FIGHTS_QUERY = `
  query ReportFights($code: String!) {
    reportData {
      report(code: $code) {
        code
        title
        startTime
        endTime
        zone {
          id
          name
        }
        fights {
          id
          encounterID
          name
          startTime
          endTime
          kill
          bossPercentage
          fightPercentage
          lastPhase
          lastPhaseIsIntermission
          friendlyPlayers
        }
      }
    }
  }
`;

const BASE_FIGHT_EVENT_FILTER = 'type = "death" OR type = "resurrect" OR (type = "applydebuff" AND ability.id = 1002911) OR (type = "damage" AND target.disposition = "friendly")';
const DEATH_CAUSE_BUFF_NAMES = [
  'Rampart',
  'Guardian',
  'Damnation',
  'Shadowed Vigil',
  'Great Nebula',
];
const FIGHT_EVENTS_QUERY = `
  query FightEvents(
    $code: String!
    $fightIDs: [Int]!
    $filterExpression: String!
    $startTime: Float
  ) {
    reportData {
      report(code: $code) {
        masterData {
          actors {
            id
            name
            type
            subType
          }
          abilities {
            gameID
            name
          }
        }
        fights(fightIDs: $fightIDs) {
          id
          startTime
          endTime
          friendlyPlayers
        }
        events(
          fightIDs: $fightIDs
          filterExpression: $filterExpression
          includeResources: true
          limit: 10000
          startTime: $startTime
        ) {
          data
          nextPageTimestamp
        }
      }
    }
  }
`;

export async function queryFflogs(query, variables = {}, { signal } = {}) {
  const accessToken = getFflogsAccessToken();
  if (!accessToken) {
    throw new Error('Not logged in to FFLogs.');
  }

  const response = await fetch(FFLOGS_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`FFLogs GraphQL endpoint returned ${response.status}.`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join('; '));
  }

  if (!payload.data) {
    throw new Error('FFLogs returned no GraphQL data.');
  }

  return payload.data;
}

export function fetchCurrentFflogsUser(options) {
  return queryFflogs(`
    query CurrentUser {
      userData {
        currentUser {
          id
          name
        }
      }
    }
  `, {}, options).then((data) => data.userData.currentUser);
}

export async function fetchReportByCode(code, options) {
  const data = await queryFflogs(REPORT_FIGHTS_QUERY, { code }, options);
  return data.reportData.report;
}

export async function fetchFightEventDetails(
  code,
  fightIds,
  mitigationAbilityIds = [],
  phaseEventReferences = [],
  options,
) {
  const normalizedFightIds = (Array.isArray(fightIds) ? fightIds : [fightIds])
    .map(Number)
    .filter(Number.isFinite);
  const mitigationFilters = mitigationAbilityIds
    .filter(Number.isFinite)
    .map((abilityId) => `(type = "cast" AND ability.id = ${abilityId})`);
  const phaseEventFilters = phaseEventReferences.map((reference) => {
    const eventType = String(reference.eventType ?? '').replace(/\s+/g, '').toLowerCase();
    const ability = escapeFflogsFilterString(reference.ability);
    const conditions = [`type = "${eventType}"`];
    if (ability) conditions.push(`ability.name = "${ability}"`);
    return `(${conditions.join(' AND ')})`;
  });
  const assignmentFilters = [
    '(type = "cast" AND ability.name = "Revolting Ruin III")',
    '(type = "cast" AND source.disposition = "friendly")',
  ];
  // Only the defensive statuses used by programmed death explanations are fetched;
  // this keeps the shared fight-event response much smaller than all buff traffic.
  const deathCauseBuffFilters = DEATH_CAUSE_BUFF_NAMES.flatMap((abilityName) => [
    `(type = "applybuff" AND ability.name = "${escapeFflogsFilterString(abilityName)}")`,
    `(type = "refreshbuff" AND ability.name = "${escapeFflogsFilterString(abilityName)}")`,
    `(type = "removebuff" AND ability.name = "${escapeFflogsFilterString(abilityName)}")`,
  ]);
  const filterExpression = [
    BASE_FIGHT_EVENT_FILTER,
    ...mitigationFilters,
    ...phaseEventFilters,
    ...assignmentFilters,
    ...deathCauseBuffFilters,
  ].join(' OR ');
  let report = null;
  const events = await collectFflogsEventPages(async (startTime) => {
    const data = await queryFflogs(FIGHT_EVENTS_QUERY, {
      code,
      fightIDs: normalizedFightIds,
      filterExpression,
      startTime,
    }, options);
    const page = data.reportData.report;
    if (!report) report = page;
    return page.events;
  });

  return {
    ...report,
    events: {
      ...report.events,
      data: events,
      nextPageTimestamp: null,
    },
  };
}

export async function collectFflogsEventPages(fetchPage) {
  let startTime = null;
  const events = [];
  const seenPageTimestamps = new Set();

  do {
    const page = await fetchPage(startTime);
    events.push(...(page?.data ?? []));
    const nextPageTimestamp = Number(page?.nextPageTimestamp) || null;
    if (nextPageTimestamp !== null) {
      if (seenPageTimestamps.has(nextPageTimestamp)) {
        throw new Error(`FFLogs repeated event page timestamp ${nextPageTimestamp}.`);
      }
      seenPageTimestamps.add(nextPageTimestamp);
    }
    startTime = nextPageTimestamp;
  } while (startTime !== null);

  return events;
}

function escapeFflogsFilterString(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function fetchWeeklyReports(userId, { cachedReports = [], ...options } = {}) {
  const endTime = Date.now();
  const startTime = endTime - (REPORT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const reports = [];
  let page = 1;

  // FFLogs paginates the user's report index separately from the full fight data.
  // Gather every index page first so the UI never silently omits older reports.
  while (true) {
    const data = await queryFflogs(REPORT_LIST_QUERY, {
      userId: Number(userId),
      startTime,
      endTime,
      limit: REPORT_PAGE_SIZE,
      page,
    }, options);
    const result = data.reportData.reports;
    reports.push(...(result.data ?? []));

    if (!result.has_more_pages && page >= (result.last_page ?? page)) {
      break;
    }

    page += 1;
  }

  // Report-list records do not contain fights. Reuse fight lists for unchanged reports,
  // and hydrate only new or updated reports with a small concurrency cap.
  const cachedReportsByCode = new Map(cachedReports.map((report) => [report.code, report]));
  const hydratedReports = await mapWithConcurrency(reports, 4, async (report) => {
    const cachedReport = cachedReportsByCode.get(report.code);
    if (cachedReport
      && Number(cachedReport.startTime) === Number(report.startTime)
      && Number(cachedReport.endTime) === Number(report.endTime)
      && Array.isArray(cachedReport.fights)) {
      return { ...report, fights: cachedReport.fights };
    }
    const data = await queryFflogs(REPORT_FIGHTS_QUERY, { code: report.code }, options);
    return data.reportData.report;
  });

  return hydratedReports
    .filter((report) => report?.fights?.length > 0)
    .sort((first, second) => second.startTime - first.startTime);
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  // Workers share the next index rather than creating every request at once; this keeps
  // FFLogs traffic bounded while preserving the input order in the result array.
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}
