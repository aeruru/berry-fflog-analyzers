# berry-fflog-analyzers

Goal: Build a small web tool that accepts an FFLogs report URL/code, fetches report/fight/event data, normalizes it, then runs custom FFXIV analysis rules.

## Local development

Start a local static server:

```powershell
npm start
```

The default port is `7999`. You can override it with an ENV var but note that fflogs is only set to auth on port 7999 when using localhost:

```powershell
$env:PORT = 8080
npm start
```

## FFLogs data access

The app uses FFLogs GraphQL v2 instead of scraping FFLogs pages. Browser users log in with FFLogs OAuth PKCE using this public client id:

```text
a210738b-1a9b-40d8-98f6-a4054696f1eb
```

By default it posts authenticated GraphQL requests to the private API:

```text
https://www.fflogs.com/api/v2/user
```

The public API is `https://www.fflogs.com/api/v2/client`, but FFLogs documents that endpoint for client-credentials tokens. Browser PKCE login uses the private `/api/v2/user` endpoint.

The FFLogs app must allow the exact redirect URL used by the page. For local testing, that is usually:

```text
http://127.0.0.1:7999/
```

For GitHub Pages, use the deployed page URL. The page's GraphQL settings section shows the active redirect URI. FFLogs requires an exact match, so `http://127.0.0.1:7999/` and the GitHub Pages URL must both be added if you want both environments to work.

After logging in, use **Load my recent reports** to query the authenticated FFLogs account, list recent reports, and hydrate each report with fight data. The app first tries to fetch reports from the logged-in token alone. If FFLogs requires a numeric `userID`, it falls back to a current-user lookup and uses that id internally. The user-id box is only for inspecting another account.

The GraphQL explorer also includes editable query templates for current user lookup, recent reports, report summary by code, and top-level schema inspection.

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
