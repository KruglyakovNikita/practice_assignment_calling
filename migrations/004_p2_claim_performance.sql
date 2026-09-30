BEGIN;

-- IDs get defaults so external seeders may omit them.
ALTER TABLE public.orgs ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.campaigns ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.contacts ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.call_attempts ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- pg_timezone_names re-reads the tz database on every call (~40 ms), which made the
-- per-row validation trigger unusable for bulk seeding. Snapshot it once.
CREATE TABLE app_private.timezones (name text PRIMARY KEY);
INSERT INTO app_private.timezones(name) SELECT DISTINCT name FROM pg_timezone_names;
REVOKE ALL ON app_private.timezones FROM PUBLIC;
GRANT SELECT ON app_private.timezones TO auto_calling_app;

CREATE OR REPLACE FUNCTION app_private.validate_contact_timezone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_private.timezones WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'invalid IANA timezone: %', NEW.timezone USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

-- Active (non-terminal) attempt marker. Maintained only by call_attempts triggers, so
-- attempts inserted directly in SQL are covered too. It keeps in-flight contacts out of the
-- claim index and makes a concurrent claimer re-check the locked row (EvalPlanQual).
ALTER TABLE public.contacts ADD COLUMN active_attempt_id uuid NULL;

UPDATE public.contacts c
   SET active_attempt_id = a.id
  FROM public.call_attempts a
 WHERE a.contact_id = c.id
   AND a.status IN ('queued', 'dialing', 'in_progress');

CREATE OR REPLACE FUNCTION app_private.on_call_attempt_inserted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status IN ('queued', 'dialing', 'in_progress') THEN
    UPDATE public.contacts SET active_attempt_id = NEW.id WHERE id = NEW.contact_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.on_call_attempt_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.contacts SET active_attempt_id = NULL
   WHERE id = OLD.contact_id AND active_attempt_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.on_call_attempts_truncated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.contacts SET active_attempt_id = NULL WHERE active_attempt_id IS NOT NULL;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION app_private.on_call_attempt_inserted() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.on_call_attempt_deleted() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.on_call_attempts_truncated() FROM PUBLIC;

CREATE TRIGGER call_attempts_mark_active
AFTER INSERT ON public.call_attempts
FOR EACH ROW EXECUTE FUNCTION app_private.on_call_attempt_inserted();
CREATE TRIGGER call_attempts_unmark_deleted
AFTER DELETE ON public.call_attempts
FOR EACH ROW EXECUTE FUNCTION app_private.on_call_attempt_deleted();
CREATE TRIGGER call_attempts_unmark_truncated
AFTER TRUNCATE ON public.call_attempts
FOR EACH STATEMENT EXECUTE FUNCTION app_private.on_call_attempts_truncated();

CREATE OR REPLACE FUNCTION app_private.on_call_attempt_terminal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status IN ('completed', 'failed', 'no_answer')
     OR NEW.status NOT IN ('completed', 'failed', 'no_answer') THEN
    RETURN NEW;
  END IF;

  UPDATE public.contacts
     SET attempts_count = attempts_count + 1,
         last_attempt_at = NEW.ended_at,
         do_not_call = CASE
           WHEN NEW.outcome -> 'do_not_call' = 'true'::jsonb THEN true
           ELSE do_not_call
         END,
         active_attempt_id = CASE
           WHEN active_attempt_id = NEW.id THEN NULL
           ELSE active_attempt_id
         END
   WHERE id = NEW.contact_id
     AND org_id = NEW.org_id
     AND campaign_id = NEW.campaign_id;

  INSERT INTO public.crm_outbox(attempt_id, org_id, payload, correlation_id)
  VALUES (
    NEW.id,
    NEW.org_id,
    jsonb_build_object(
      'attempt_id', NEW.id,
      'status', NEW.status,
      'outcome', COALESCE(NEW.outcome, '{}'::jsonb)
    ),
    NEW.correlation_id
  )
  ON CONFLICT (attempt_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Claim index: only claimable rows, grouped by timezone so the local-time rule becomes an
-- index lookup per in-window zone; cooldown is a range condition on the third column.
DROP INDEX IF EXISTS public.contacts_claim_lookup_idx;
CREATE INDEX contacts_claim_ready_idx
  ON public.contacts(campaign_id, timezone, (COALESCE(last_attempt_at, '-infinity'::timestamptz)), id)
  WHERE do_not_call = false AND attempts_count < 3 AND active_attempt_id IS NULL;

CREATE OR REPLACE FUNCTION public.claim_next_contact(p_campaign_id uuid)
RETURNS TABLE(id uuid, phone_e164 text, attempt_id uuid)
LANGUAGE plpgsql
-- DEFINER: the signed JWT is verified once here and every statement filters by v_org_id
-- explicitly. Under INVOKER each of the per-zone probes re-verified the JWT through RLS.
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_org_id uuid := app_private.current_org_id();
  v_now timestamptz := clock_timestamp();
  v_zones text[];
  v_zone text;
  v_contact public.contacts%ROWTYPE;
  v_attempt_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.campaigns c
     WHERE c.id = p_campaign_id AND c.org_id = v_org_id AND c.status = 'active'
  ) THEN
    RETURN;
  END IF;

  -- Timezones present among claimable contacts of the campaign (loose index scan over
  -- contacts_claim_ready_idx), kept if local time is inside [09:00, 20:00), shuffled so
  -- parallel workers spread across zones.
  WITH RECURSIVE present(tz) AS (
    SELECT min(c.timezone)
      FROM public.contacts c
     WHERE c.campaign_id = p_campaign_id
       AND c.do_not_call = false AND c.attempts_count < 3 AND c.active_attempt_id IS NULL
    UNION ALL
    SELECT (
      SELECT min(c.timezone)
        FROM public.contacts c
       WHERE c.campaign_id = p_campaign_id
         AND c.do_not_call = false AND c.attempts_count < 3 AND c.active_attempt_id IS NULL
         AND c.timezone > present.tz
    )
      FROM present
     WHERE present.tz IS NOT NULL
  )
  SELECT array_agg(present.tz ORDER BY random()) INTO v_zones
    FROM present
   WHERE present.tz IS NOT NULL
     AND (v_now AT TIME ZONE present.tz)::time >= time '09:00'
     AND (v_now AT TIME ZONE present.tz)::time < time '20:00';

  -- One index probe per zone (contacts_claim_ready_idx: campaign, timezone, cooldown range).
  -- Cost is bounded by the number of distinct zones in the campaign, not by its size.
  -- No global ORDER BY (it would sort every eligible row); within a zone the index yields
  -- never-called / oldest-called contacts first.
  FOREACH v_zone IN ARRAY COALESCE(v_zones, '{}') LOOP
    SELECT c.*
      INTO v_contact
      FROM public.contacts c
     WHERE c.campaign_id = p_campaign_id
       AND c.timezone = v_zone
       AND COALESCE(c.last_attempt_at, '-infinity'::timestamptz) <= v_now - interval '4 hours'
       AND c.do_not_call = false
       AND c.attempts_count < 3
       AND c.active_attempt_id IS NULL
       AND c.org_id = v_org_id
       AND NOT EXISTS (
         SELECT 1
           FROM public.call_attempts a
          WHERE a.contact_id = c.id
            AND a.org_id = v_org_id
            AND a.status IN ('queued', 'dialing', 'in_progress')
       )
     ORDER BY COALESCE(c.last_attempt_at, '-infinity'::timestamptz), c.id
     LIMIT 1
     FOR UPDATE OF c SKIP LOCKED;
    EXIT WHEN FOUND;
  END LOOP;

  -- FOREACH itself sets FOUND, so test the row instead.
  IF v_contact.id IS NULL THEN
    RETURN;
  END IF;

  v_attempt_id := gen_random_uuid();

  INSERT INTO public.call_attempts(
    id, org_id, campaign_id, contact_id, provider_call_id, status
  ) VALUES (
    v_attempt_id,
    v_contact.org_id,
    v_contact.campaign_id,
    v_contact.id,
    v_attempt_id::text,
    'queued'
  );

  RETURN QUERY SELECT v_contact.id, v_contact.phone_e164, v_attempt_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_contact(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_next_contact(uuid) TO auto_calling_app;

-- Webhook ingestion does INSERT ... RETURNING id, which needs SELECT as well.
GRANT SELECT ON public.webhook_events TO auto_calling_service;

-- FOR SHARE on campaigns is gone, so the web role no longer needs UPDATE there.
REVOKE UPDATE ON public.campaigns FROM auto_calling_app;

ANALYZE public.contacts;

COMMIT;
