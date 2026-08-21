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

export async function fetchWeeklyReports(userId, options) {
  const endTime = Date.now();
  const startTime = endTime - (REPORT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const reports = [];
  let page = 1;

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

  const hydratedReports = await mapWithConcurrency(reports, 4, async (report) => {
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
