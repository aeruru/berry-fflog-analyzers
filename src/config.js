export const UNKNOWN_ZONE_NAMES = new Set(['unknown', 'unknown zone', '']);
export const FFLOGS_CLIENT_ID = 'a210738b-1a9b-40d8-98f6-a4054696f1eb';
export const FFLOGS_AUTH_URL = 'https://www.fflogs.com/oauth/authorize';
export const FFLOGS_TOKEN_URL = 'https://www.fflogs.com/oauth/token';
export const TOKEN_STORAGE_KEY = 'berry.fflogs.pkce.token';
export const USER_STORAGE_KEY = 'berry.fflogs.user';
export const PKCE_STORAGE_KEY = 'berry.fflogs.pkce.pending';
export const CACHE_STORAGE_PREFIX = 'berry.fflogs.cache.';
export const TEST_DATA_URL = 'fflogs-testdata/sample-report-fights.json';
export const GRAPHQL_ENDPOINT = 'https://www.fflogs.com/api/v2/user';
export const TARGET_ZONE_ID = 76;
export const TARGET_ZONE_NAME = 'Dancing Mad';
export const TARGET_REPORT_LOOKBACK_DAYS = 7;
export const TARGET_ZONE_REPORT_LIMIT = 100;
export const DAMAGE_DOWN_ABILITY_ID = 1002911;
export const FIGHT_EVENT_FILTER = `type = "death" OR (type = "applydebuff" AND ability.id = ${DAMAGE_DOWN_ABILITY_ID})`;

export const RECENT_REPORTS_QUERY = `
  query RecentUserReports($userId: Int!, $limit: Int!, $zoneId: Int, $startTime: Float, $endTime: Float) {
    reportData {
      reports(userID: $userId, limit: $limit, zoneID: $zoneId, startTime: $startTime, endTime: $endTime) {
        data {
          code
          title
          startTime
          endTime
          zone {
            name
          }
        }
      }
    }
  }
`;

export const CURRENT_USER_QUERY = `
  query CurrentUser {
    userData {
      currentUser {
        id
        name
      }
    }
  }
`;

export const CURRENT_USER_QUERY_CANDIDATES = [
  CURRENT_USER_QUERY,
];

export const REPORT_FIGHTS_QUERY = `
  query ReportFights($code: String!) {
    reportData {
      report(code: $code) {
        code
        title
        startTime
        endTime
        zone {
          name
        }
        fights {
          id
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

export const FIGHT_EVENTS_QUERY = `
  query FightEvents($code: String!, $fightIDs: [Int]!, $filterExpression: String!) {
    reportData {
      report(code: $code) {
        masterData {
          actors {
            id
            name
            type
            subType
          }
        }
        fights(fightIDs: $fightIDs) {
          id
          bossPercentage
          fightPercentage
          lastPhase
          lastPhaseIsIntermission
          friendlyPlayers
        }
        events(fightIDs: $fightIDs, filterExpression: $filterExpression, limit: 10000) {
          data
        }
      }
    }
  }
`;
