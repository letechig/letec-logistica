---
name: release-guard
description: "Use when: Supabase changes, RLS errors, schema cache errors, NOT NULL failures, deploy regressions, backend/frontend payload mismatch, production hotfix checklist"
---

# Release Guard

Workflow skill to prevent regressions when changing database schema and API contracts.

## When to run
- RLS error appears in UI
- "Could not find column ... in schema cache"
- NOT NULL / constraint violation in insert or update
- Frontend and backend payload are out of sync
- Deploy works locally but fails in Render/Vercel

## Mandatory Checklist

1. Entry point sanity
- Confirm official UI entrypoint is `frontend/index.html`.
- Ensure legacy files only redirect and do not execute data writes.

2. Database contract
- List expected columns for target table.
- Verify NOT NULL columns are always present in payload.
- Add compatibility columns only if required for transition.
- Backfill nulls before enforcing constraints.

3. RLS policy gate
- If frontend writes directly to Supabase, validate policies for `anon` and `authenticated`.
- Prefer backend API writes with service role for privileged operations.
- If backend is source of truth, tighten `anon` write policies later.

4. API contract
- Validate backend endpoints for create/update/delete.
- Validate required fields and reject invalid enum/domain values.
- Return readable `400/409/404/500` errors.

5. Frontend contract
- Never send empty required fields.
- Show user-facing error from backend response.
- Refresh local catalogs after successful mutation.

6. Deploy verification
- Confirm deployed URL points to maintained frontend.
- Verify `API_BASE_URL` resolution in production.
- Check Render logs for endpoint status and SQL errors.

7. Smoke test (must pass)
- Create entity with all required fields.
- Edit entity and switch enum paths if applicable.
- Delete entity.
- Run one dependent flow to ensure no runtime regression.

## Fast SQL diagnostics template

```sql
-- Replace table/columns as needed
SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'service_types'
ORDER BY ordinal_position;
```

## Exit criteria
- No schema cache or NOT NULL errors in UI.
- CRUD works end-to-end in production.
- Only one active write path (backend preferred).
