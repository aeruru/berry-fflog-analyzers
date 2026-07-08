# berry-fflog-analyzers

Client-only web app that loads a logged-in FFLogs user's recent Dancing Mad reports and highlights pull-level death and damage down events.

## Local development

Start a local static server:

```powershell
npm start
```

The default port is `7999`. Use `http://127.0.0.1:7999/` in the browser. FFLogs OAuth redirect URLs must match exactly, so `http://localhost:7999/` is different from `http://127.0.0.1:7999/`.

```powershell
# example of how to override port
$env:PORT = 8080
npm start
```

## FFLogs data access

The app uses FFLogs GraphQL v2 instead of scraping FFLogs pages. Browser users log in with FFLogs OAuth PKCE using this public client ID:

```text
a210738b-1a9b-40d8-98f6-a4054696f1eb
```

After login, the browser stores the FFLogs access token in local storage with an expiration timestamp. The app posts authenticated GraphQL requests to the user API:

```text
https://www.fflogs.com/api/v2/user
```

The public API is `https://www.fflogs.com/api/v2/client`, but that endpoint is for client-credentials tokens. Browser PKCE login uses `/api/v2/user`.

The FFLogs app must allow the exact redirect URL used by the page. For local testing, that is usually:

```text
http://127.0.0.1:7999/
```

For GitHub Pages, add the deployed page URL as another redirect URL. FFLogs requires an exact match, so `http://127.0.0.1:7999/` and the GitHub Pages URL must both be configured if you want both environments to work.

After logging in, the app looks up the current FFLogs user, loads that user's Dancing Mad reports from the last 7 days, and renders report cards. Report cards are initially lightweight; fight data is fetched only when a report is expanded. Fight event data is fetched only when a fight's **Details** button is opened.

The event query is filtered to death events and damage down debuff applications:

```text
type = "death" OR (type = "applydebuff" AND ability.id = 1002911)
```

Results are cached client-side in local storage. Cache entries include the GraphQL endpoint, query hash, and variables. Use the app's clear-cache buttons to clear all cached data, a report's cached data, or a fight's cached event data.

The **Use test data** toggle loads a local JSON fixture instead of calling FFLogs. This is useful for UI development without logging in.

## Optional: Altair GraphQL exploration

The web app no longer includes a GraphQL explorer. For separate schema/query exploration, use an external client such as Altair.

Use the [get-fflogs-token.ps1](scripts/get-fflogs-token.ps1) script to generate a bearer token for Altair. You can get a client ID and client secret from FFLogs and set them in a file named `.env.local`:

```ini
FFLOGS_CLIENT_ID=<client_id>
FFLOGS_CLIENT_SECRET=<client_secret>
```

Within Altair Client, set this in your environment:
```json
{
  "fflogsUrl": "https://www.fflogs.com/api/v2/client",
  "authToken": "<bearer_token>"
}
```

Then set URL to `{{fflogsUrl}}` and Auth to:
```
Auth type = Bearer Token
Bearer Token = {{authToken}}
```

Add this to the `Variables` panel in the lower left:
```json
{
  "userId":3430,
  "zoneIdDMU":76,
  "reportIdDMU":"wYrjyBv1ZMpJ3aGV",
  "fightIdsDMU": [18]
}
```

Here are 3 queries to try out:
```graphql
query UserInfo (
  $userId: Int!
) {
  userData {
    user(
      id:$userId
      ) {
      name
    }
  }
}


query MyRecentReports(
  $userId: Int!,
  $zoneIdDMU: Int!
) {
  reportData {
    reports(
      userID: $userId,
      zoneID: $zoneIdDMU,
      limit: 1
    ) {
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

query ExploreFightEvents (
  $reportIdDMU: String!,
  $fightIdsDMU: [Int]
) {
  reportData {
    report (
      code: $reportIdDMU,
    ) {
      events(
        fightIDs: $fightIdsDMU,
      ) {
        data
        nextPageTimestamp
      }
    }
  }
}
```

## Key findings

* `xivanalysis` is the best reference for FFXIV-specific log interpretation, but not a drop-in parsing library.
* It is a TypeScript/React app using a custom FFLogs integration, not an FFLogs SDK.
* Its FFLogs code is under `src/reportSources/legacyFflogs/`.
* "legacy" mostly means xivanalysis's older report-store adapter, not necessarily that the whole project is obsolete.
* For a new app, prefer FFLogs GraphQL v2 via a backend/serverless API rather than putting FFLogs credentials in the browser.
* Use xivanalysis as reference for event normalization and analysis logic: actor merging, status handling, prepull actions, deduping events, job/boss modules.
* Avoid copying huge chunks blindly; selectively adapt MIT-licensed pieces with attribution.

## Top resources

1. xivanalysis repo, MIT-licensed reference implementation: [https://github.com/xivanalysis/xivanalysis](https://github.com/xivanalysis/xivanalysis)
2. xivanalysis FFLogs integration folder: [https://github.com/xivanalysis/xivanalysis/tree/dawntrail/src/reportSources/legacyFflogs](https://github.com/xivanalysis/xivanalysis/tree/dawntrail/src/reportSources/legacyFflogs)
3. Python FFLogs GraphQL v2 client, useful reference but GPLv3 license: [https://github.com/halworsen/fflogsapi](https://github.com/halworsen/fflogsapi)

## Suggested architecture

* Frontend: log in with FFLogs, list target-zone reports, expand reports/fights, display focused analysis.
* Optional backend/serverless: eventually move FFLogs OAuth/client credentials and GraphQL requests out of the browser if this grows beyond a local utility.
* Core analysis library:

  * `getReport(code)`
  * `getFights(code)`
  * `getFightEvents(code, fightId)`
  * normalize raw FFLogs events into internal event model
  * run analysis rules
* Start with one narrow analyzer, e.g. potion usage, deaths before mitigation, raid buff alignment, missed 2-minute cooldowns, healer mitigation timeline, or cast uptime.
