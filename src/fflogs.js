import {
  CURRENT_USER_QUERY_CANDIDATES,
  RECENT_REPORTS_QUERY,
  REPORT_FIGHTS_QUERY,
  TARGET_REPORT_LOOKBACK_DAYS,
  TARGET_ZONE_ID,
  TARGET_ZONE_REPORT_LIMIT,
  TOKEN_STORAGE_KEY,
} from './config.js';
import {
  hashString,
  makeCacheKey,
  readCacheEntry,
  writeCacheEntry,
} from './cache.js';
import { getStoredToken, isExpired } from './auth.js';
import { normalizeReportList, normalizeSession } from './normalize.js';

export async function fetchMyRecentSessions({ endpoint, onExpired }) {
  const user = await fetchCurrentUser({ endpoint, onExpired });
  const targetZoneReports = await fetchRecentSessions({
    endpoint,
    userId: user.id,
    limit: TARGET_ZONE_REPORT_LIMIT,
    zoneId: TARGET_ZONE_ID,
    ...getLookbackRange(TARGET_REPORT_LOOKBACK_DAYS),
    onExpired,
  });
  const normalized = targetZoneReports;

  return { normalized, targetZoneReports, user };
}

export async function fetchRecentSessions({ endpoint, userId, limit = 100, zoneId = null, startTime = null, endTime = null, onExpired }) {
  const variables = {
    userId,
    limit,
  };

  if (zoneId !== null) {
    variables.zoneId = zoneId;
  }

  if (startTime !== null) {
    variables.startTime = startTime;
  }

  if (endTime !== null) {
    variables.endTime = endTime;
  }

  const reportsResult = await cachedFflogsGraphql('RecentUserReports', endpoint, RECENT_REPORTS_QUERY, variables, { onExpired });
  const reports = reportsResult?.data?.reportData?.reports?.data ?? [];
  return normalizeReportList(reports).map((session) => ({
    ...session,
    fightsLoaded: false,
  }));
}

export async function fetchReportFights(session, { endpoint, onExpired }) {
  if (!session.reportCode) {
    throw new Error('report code unavailable');
  }

  const fightsResult = await cachedFflogsGraphql('ReportFights', endpoint, REPORT_FIGHTS_QUERY, { code: session.reportCode }, { onExpired });
  const report = fightsResult?.data?.reportData?.report;
  return normalizeSession({
    ...report,
    code: session.reportCode,
    title: report?.title ?? session.title,
    zone: report?.zone ?? session.zoneName,
    fightsLoaded: true,
  }, session.id);
}

export async function fetchCurrentUser({ endpoint, onExpired }) {
  const errors = [];

  for (const query of CURRENT_USER_QUERY_CANDIDATES) {
    try {
      const result = await fflogsGraphql(endpoint, query, {}, { onExpired });
      const user = result?.data?.userData?.currentUser
        ?? result?.data?.userData?.user
        ?? result?.data?.currentUser;

      if (user?.id) {
        return user;
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(`FFLogs did not expose a current-user field in the attempted GraphQL shapes. Errors: ${errors.join(' | ')}`);
}

export async function cachedFflogsGraphql(queryName, endpoint, query, variables, { onExpired } = {}) {
  const cacheKey = makeCacheKey(queryName, {
    endpoint,
    queryHash: hashString(query),
    variables,
  });
  const cached = readCacheEntry(cacheKey);

  if (cached) {
    return cached;
  }

  const payload = await fflogsGraphql(endpoint, query, variables, { onExpired });
  writeCacheEntry(cacheKey, payload);
  return payload;
}

async function fflogsGraphql(endpoint, query, variables, { onExpired } = {}) {
  const payload = await fflogsGraphqlRaw(endpoint, query, variables, { onExpired });

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join('; '));
  }

  return payload;
}

async function fflogsGraphqlRaw(endpoint, query, variables, { onExpired } = {}) {
  const token = getStoredToken();

  if (!token) {
    throw new Error('not logged in to FFLogs');
  }

  const headers = {
    authorization: `Bearer ${token.access_token}`,
    'content-type': 'application/json',
  };

  if (isExpired(token)) {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    onExpired?.();
    throw new Error('FFLogs login expired. Log in again.');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL endpoint returned ${response.status}`);
  }

  return response.json();
}

function getLookbackRange(days) {
  const endTime = Date.now();
  const startTime = endTime - (days * 24 * 60 * 60 * 1000);
  return { startTime, endTime };
}
