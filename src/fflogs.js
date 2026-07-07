import {
  CURRENT_USER_QUERY_CANDIDATES,
  RECENT_REPORTS_QUERY,
  REPORT_FIGHTS_QUERY,
  TARGET_ZONE_ID,
  TARGET_ZONE_REPORT_LIMIT,
  TOKEN_STORAGE_KEY,
  UNKNOWN_ZONE_NAMES,
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

  const [normalized, targetZoneReports] = await Promise.all([
    fetchRecentSessions({
      endpoint,
      userId: user.id,
      onExpired,
    }),
    fetchRecentSessions({
      endpoint,
      userId: user.id,
      limit: TARGET_ZONE_REPORT_LIMIT,
      zoneId: TARGET_ZONE_ID,
      onExpired,
    }),
  ]);

  return { normalized, targetZoneReports, user };
}

export async function fetchRecentSessions({ endpoint, userId, limit = 12, zoneId = null, onExpired }) {
  const variables = {
    userId,
    limit,
  };

  if (zoneId !== null) {
    variables.zoneId = zoneId;
  }

  const reportsResult = await cachedFflogsGraphql('RecentUserReports', endpoint, RECENT_REPORTS_QUERY, variables, { onExpired });
  const reports = reportsResult?.data?.reportData?.reports?.data ?? [];
  return hydrateReportSessions(reports, { endpoint, onExpired });
}

async function hydrateReportSessions(reports, { endpoint, onExpired }) {
  const baseSessions = normalizeReportList(reports).slice(0, 6);

  const hydratedSessions = await Promise.all(baseSessions.map(async (session) => {
    if (!session.reportCode) {
      return session;
    }

    try {
      const fightsResult = await cachedFflogsGraphql('ReportFights', endpoint, REPORT_FIGHTS_QUERY, { code: session.reportCode }, { onExpired });
      const report = fightsResult?.data?.reportData?.report;
      return normalizeSession({
        ...report,
        code: session.reportCode,
        title: report?.title ?? session.title,
        zone: report?.zone ?? session.zoneName,
      }, session.id);
    } catch (error) {
      console.warn(`Could not hydrate fights for report ${session.reportCode}`, error);
      return {
        ...session,
        hydrationError: error.message,
      };
    }
  }));

  return hydratedSessions
    .filter((session) => !UNKNOWN_ZONE_NAMES.has(session.zoneName.trim().toLowerCase()))
    .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
    .slice(0, 6);
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
