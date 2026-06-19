# berry-fflog-analyzers

Goal: Build a small web tool that accepts an FFLogs report URL/code, fetches report/fight/event data, normalizes it, then runs custom FFXIV analysis rules.

## Local development

Start a local static server:

```powershell
npm start
```

The default port is `7999`. Override it with `PORT`:

```powershell
$env:PORT = 8080
npm start
```

## FFLogs data access

The app uses FFLogs GraphQL v2 instead of scraping FFLogs pages. By default it posts GraphQL requests to:

```text
/api/fflogs/graphql
```

That endpoint should be a small backend or serverless proxy that adds the FFLogs OAuth bearer token server-side and forwards requests to:

```text
https://www.fflogs.com/api/v2/client
```

For local experiments only, the page has a GraphQL settings section where you can point directly at a compatible endpoint and paste a temporary bearer token.

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

* Frontend: paste FFLogs URL/code, choose fight/player, display results.
* Backend/serverless: handle FFLogs OAuth/client credentials and GraphQL requests.
* Core library:

  * `getReport(code)`
  * `getFights(code)`
  * `getFightEvents(code, fightId)`
  * normalize raw FFLogs events into internal event model
  * run analysis rules
* Start with one narrow analyzer, e.g. potion usage, deaths before mitigation, raid buff alignment, missed 2-minute cooldowns, healer mitigation timeline, or cast uptime.
