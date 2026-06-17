# Extending OneRoster `metadata` with Custom Fields — Post-Refresh Hook

This document describes the supported extension point for adding custom fields to the
OneRoster `metadata` (and `userIds`) output **without modifying any Ed‑Fi‑shipped
SQL artifact**, ensuring customizations remain upgrade-safe.

It describes the MSSQL mechanism; a PostgreSQL note is at the end. Writing the
enrichment SQL itself (which fields, from which source tables) is up to the
implementer and is out of scope here.

---

## 1. Background: where `metadata` comes from

The OneRoster API serves `metadata` straight from storage rather than building it
at request time. Each entity is materialized into a table (`oneroster12.<entity>`)
by a refresh stored procedure, and the `metadata` column (an `NVARCHAR(MAX)` JSON
string) is built during that refresh. The API selects the column and returns it
verbatim.

Two consequences:

- To change `metadata`, you change the data in the table — not the API. Adding
  JSON keys needs **no schema/DDL change**.
- Tables are rebuilt on **every** refresh, so a customization must run as part of
  the refresh cycle. The supported way to do this is the built‑in **post‑refresh
  hook** (§3).

---

## 2. The overlay principle

`standard/deploy-mssql.js` scans the `core/` and `orchestration/` folders and runs
**every** `.sql` file it finds. Files with a numeric prefix run first; files with
**no** prefix run last, alphabetically.

So you add customizations as new `.sql` files named to sort after the Ed‑Fi files
(e.g. prefix with `zz_`). You add only **new** database objects and never edit a
shipped file, so upgrades drop in without conflict.

---

## 3. The post-refresh hook

`oneroster12.sp_refresh_all` contains a built‑in extension point: after all core
tables are refreshed, it calls `oneroster12.sp_refresh_post_hook` **only if that
procedure exists**, wrapped in `TRY/CATCH` so a failing customization is logged
to `refresh_errors` (`table_name = 'post_hook'`). Because your existing schedule
already calls `sp_refresh_all`, the hook runs automatically with **no scheduling
changes**.

To customize, you deploy two kinds of object as overlay files in `core/`:

**1. A hook procedure** named exactly `oneroster12.sp_refresh_post_hook`, which
calls your enrichment procedures:

```sql
-- File: standard/5.2.0/artifacts/mssql/core/zz_custom_post_hook.sql
CREATE OR ALTER PROCEDURE oneroster12.sp_refresh_post_hook
AS
BEGIN
    SET NOCOUNT ON;
    EXEC oneroster12.sp_custom_enrich_demographics;
    -- EXEC oneroster12.sp_custom_enrich_users;   -- add more as needed
END
GO
```

**2. One enrichment procedure per entity**, which merges your fields into the
existing `metadata` (or `userIds`) JSON with `JSON_MODIFY` — for example:

```sql
-- File: standard/5.2.0/artifacts/mssql/core/zz_custom_demographics.sql
CREATE OR ALTER PROCEDURE oneroster12.sp_custom_enrich_demographics
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE oneroster12.demographics
    SET metadata = JSON_MODIFY(ISNULL(metadata, '{}'), '$.<yourKey>', <yourValue>)
    /* join to your source table(s) for the value */;
END
GO
```

The source tables, keys, and join logic are yours to define.

---

## 4. Deployment

1. Place your overlay files in `standard/<version>/artifacts/mssql/core/`:
   - the hook proc — `zz_custom_post_hook.sql`
   - one enrichment proc per entity — `zz_custom_<entity>.sql`
2. Apply them by running the deployer (`node standard/deploy-mssql.js ds5`, which
   picks up the new files automatically) **or** by running the `.sql` files
   directly via `sqlcmd`/SSMS. `CREATE OR ALTER` statements are safe to re‑run.
3. **No scheduling change is required** — `sp_refresh_all` calls the hook on every
   refresh.

Verify with a forced refresh, then confirm the keys appear via the API or a direct
query. If a customization errors, the core refresh still completes — check
`SELECT * FROM oneroster12.refresh_errors WHERE table_name = 'post_hook'`.

```sql
EXEC oneroster12.sp_refresh_all @ForceRefresh = 1;
```

---

## 5. PostgreSQL

PostgreSQL support for this hook is **not yet available**. PG entities are
read‑only materialized views with no in‑place update path, so the equivalent
mechanism is being designed separately (a projection view layer plus a refresh
hook invoked from the application). Until then, PG customizations require
redefining the materialized view. This introduces higher upgrade overhead.
Engage the OneRoster team before implementing PostgreSQL customizations.

---
