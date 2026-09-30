BEGIN;

-- claim_next_contact() takes `FOR SHARE` on campaigns, which Postgres requires UPDATE
-- privilege for (row-locking clauses need it even when no column is written).
GRANT UPDATE ON public.campaigns TO auto_calling_app;

COMMIT;
