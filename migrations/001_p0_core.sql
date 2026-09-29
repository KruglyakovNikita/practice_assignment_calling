BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE SCHEMA IF NOT EXISTS app_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS app_private.settings (
  key text PRIMARY KEY,
  value text NOT NULL
);
REVOKE ALL ON app_private.settings FROM PUBLIC;
REVOKE ALL ON app_private.settings FROM auto_calling_app;

CREATE TABLE public.orgs (
  id uuid PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE public.campaigns (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'active', 'paused')),
  CONSTRAINT campaigns_org_fk FOREIGN KEY (org_id) REFERENCES public.orgs(id),
  CONSTRAINT campaigns_id_org_unique UNIQUE (id, org_id)
);

CREATE TABLE public.contacts (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  phone_e164 text NOT NULL,
  timezone text NOT NULL,
  attempts_count integer NOT NULL DEFAULT 0 CHECK (attempts_count >= 0),
  last_attempt_at timestamptz NULL,
  do_not_call boolean NOT NULL DEFAULT false,
  CONSTRAINT contacts_campaign_org_fk FOREIGN KEY (campaign_id, org_id)
    REFERENCES public.campaigns(id, org_id),
  CONSTRAINT contacts_id_org_campaign_unique UNIQUE (id, org_id, campaign_id)
);

CREATE TABLE public.call_attempts (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  provider_call_id text NULL,
  status text NOT NULL CHECK (status IN ('queued', 'dialing', 'in_progress', 'completed', 'failed', 'no_answer')),
  started_at timestamptz NULL,
  ended_at timestamptz NULL,
  outcome jsonb NULL,
  transcript text NULL,
  last_sequence bigint NULL,
  correlation_id text NULL,
  CONSTRAINT call_attempts_contact_org_campaign_fk FOREIGN KEY (contact_id, org_id, campaign_id)
    REFERENCES public.contacts(id, org_id, campaign_id)
);

CREATE UNIQUE INDEX call_attempts_provider_call_id_unique
  ON public.call_attempts(provider_call_id)
  WHERE provider_call_id IS NOT NULL;

CREATE UNIQUE INDEX call_attempts_one_active_per_contact
  ON public.call_attempts(contact_id)
  WHERE status IN ('queued', 'dialing', 'in_progress');

CREATE TABLE public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id text NOT NULL,
  provider_call_id text NOT NULL,
  sequence bigint NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  org_id uuid NOT NULL,
  correlation_id text NOT NULL,
  CONSTRAINT webhook_events_org_fk FOREIGN KEY (org_id) REFERENCES public.orgs(id),
  CONSTRAINT webhook_events_provider_event_unique UNIQUE (provider_event_id),
  CONSTRAINT webhook_events_call_sequence_unique UNIQUE (provider_call_id, sequence)
);

CREATE TABLE public.crm_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL UNIQUE,
  org_id uuid NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivering', 'delivered', 'dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz NULL,
  lease_token uuid NULL,
  last_error text NULL,
  delivered_at timestamptz NULL,
  correlation_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_outbox_attempt_fk FOREIGN KEY (attempt_id) REFERENCES public.call_attempts(id),
  CONSTRAINT crm_outbox_org_fk FOREIGN KEY (org_id) REFERENCES public.orgs(id)
);

CREATE INDEX contacts_claim_lookup_idx
  ON public.contacts(org_id, campaign_id, do_not_call, attempts_count, last_attempt_at, id);
CREATE INDEX call_attempts_contact_status_idx
  ON public.call_attempts(contact_id, status);
CREATE INDEX webhook_events_org_received_idx
  ON public.webhook_events(org_id, received_at DESC);
CREATE INDEX crm_outbox_ready_idx
  ON public.crm_outbox(next_attempt_at, id)
  WHERE status = 'pending';
CREATE INDEX crm_outbox_expired_lease_idx
  ON public.crm_outbox(lease_until, id)
  WHERE status = 'delivering';

CREATE OR REPLACE FUNCTION app_private.base64url_decode(value text)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
  SELECT decode(
    translate(value || repeat('=', (4 - length(value) % 4) % 4), '-_', '+/'),
    'base64'
  );
$$;

CREATE OR REPLACE FUNCTION app_private.jwt_claims()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app_private, public
AS $$
DECLARE
  token text := current_setting('app.jwt', true);
  parts text[];
  header jsonb;
  claims jsonb;
  secret text;
  expected_signature text;
  now_epoch numeric := extract(epoch FROM clock_timestamp());
BEGIN
  IF token IS NULL OR token = '' THEN
    RAISE EXCEPTION 'tenant JWT context is missing' USING ERRCODE = '28000';
  END IF;

  parts := string_to_array(token, '.');
  IF array_length(parts, 1) <> 3 THEN
    RAISE EXCEPTION 'tenant JWT is invalid' USING ERRCODE = '28000';
  END IF;

  BEGIN
    header := convert_from(app_private.base64url_decode(parts[1]), 'UTF8')::jsonb;
    claims := convert_from(app_private.base64url_decode(parts[2]), 'UTF8')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'tenant JWT is invalid' USING ERRCODE = '28000';
  END;

  IF header ->> 'alg' IS DISTINCT FROM 'HS256' THEN
    RAISE EXCEPTION 'tenant JWT algorithm is invalid' USING ERRCODE = '28000';
  END IF;

  SELECT value INTO secret FROM app_private.settings WHERE key = 'jwt_secret';
  IF secret IS NULL OR secret = '' THEN
    RAISE EXCEPTION 'tenant JWT verifier is not configured' USING ERRCODE = '28000';
  END IF;

  expected_signature := rtrim(
    translate(
      encode(
        public.hmac(
          convert_to(parts[1] || '.' || parts[2], 'UTF8'),
          convert_to(secret, 'UTF8'),
          'sha256'
        ),
        'base64'
      ),
      '+/',
      '-_'
    ),
    '='
  );

  IF expected_signature IS DISTINCT FROM parts[3] THEN
    RAISE EXCEPTION 'tenant JWT signature is invalid' USING ERRCODE = '28000';
  END IF;

  IF nullif(claims ->> 'sub', '') IS NULL
    OR nullif(claims ->> 'org_id', '') IS NULL
    OR claims ->> 'role' NOT IN ('worker', 'authenticated') THEN
    RAISE EXCEPTION 'tenant JWT claims are invalid' USING ERRCODE = '28000';
  END IF;

  PERFORM (claims ->> 'org_id')::uuid;

  IF claims ? 'exp' AND (claims ->> 'exp')::numeric <= now_epoch THEN
    RAISE EXCEPTION 'tenant JWT is expired' USING ERRCODE = '28000';
  END IF;

  IF claims ? 'nbf' AND (claims ->> 'nbf')::numeric > now_epoch THEN
    RAISE EXCEPTION 'tenant JWT is not active' USING ERRCODE = '28000';
  END IF;

  RETURN claims;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app_private
AS $$
  SELECT (app_private.jwt_claims() ->> 'org_id')::uuid;
$$;

REVOKE ALL ON FUNCTION app_private.base64url_decode(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.jwt_claims() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.current_org_id() FROM PUBLIC;
GRANT USAGE ON SCHEMA app_private TO auto_calling_app;
GRANT EXECUTE ON FUNCTION app_private.current_org_id() TO auto_calling_app;

ALTER TABLE public.orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orgs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.call_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.crm_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_outbox FORCE ROW LEVEL SECURITY;

CREATE POLICY orgs_tenant_policy ON public.orgs
  TO auto_calling_app
  USING (id = (SELECT app_private.current_org_id()))
  WITH CHECK (id = (SELECT app_private.current_org_id()));
CREATE POLICY campaigns_tenant_policy ON public.campaigns
  TO auto_calling_app
  USING (org_id = (SELECT app_private.current_org_id()))
  WITH CHECK (org_id = (SELECT app_private.current_org_id()));
CREATE POLICY contacts_tenant_policy ON public.contacts
  TO auto_calling_app
  USING (org_id = (SELECT app_private.current_org_id()))
  WITH CHECK (org_id = (SELECT app_private.current_org_id()));
CREATE POLICY call_attempts_tenant_policy ON public.call_attempts
  TO auto_calling_app
  USING (org_id = (SELECT app_private.current_org_id()))
  WITH CHECK (org_id = (SELECT app_private.current_org_id()));
CREATE POLICY webhook_events_tenant_policy ON public.webhook_events
  TO auto_calling_app
  USING (org_id = (SELECT app_private.current_org_id()))
  WITH CHECK (org_id = (SELECT app_private.current_org_id()));
CREATE POLICY crm_outbox_tenant_policy ON public.crm_outbox
  TO auto_calling_app
  USING (org_id = (SELECT app_private.current_org_id()))
  WITH CHECK (org_id = (SELECT app_private.current_org_id()));

GRANT SELECT ON public.orgs, public.campaigns, public.contacts, public.call_attempts, public.webhook_events TO auto_calling_app;
GRANT UPDATE ON public.contacts, public.call_attempts TO auto_calling_app;
GRANT INSERT ON public.call_attempts TO auto_calling_app;

GRANT SELECT, UPDATE ON public.call_attempts TO auto_calling_service;
GRANT INSERT ON public.webhook_events TO auto_calling_service;
GRANT SELECT, UPDATE ON public.crm_outbox TO auto_calling_service;

CREATE OR REPLACE FUNCTION app_private.validate_contact_timezone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'invalid IANA timezone: %', NEW.timezone USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.validate_contact_timezone() FROM PUBLIC;
CREATE TRIGGER contacts_validate_timezone
BEFORE INSERT OR UPDATE OF timezone ON public.contacts
FOR EACH ROW EXECUTE FUNCTION app_private.validate_contact_timezone();

CREATE OR REPLACE FUNCTION public.claim_next_contact(p_campaign_id uuid)
RETURNS TABLE(id uuid, phone_e164 text, attempt_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_org_id uuid := app_private.current_org_id();
  v_campaign_status text;
  v_contact public.contacts%ROWTYPE;
  v_attempt_id uuid;
BEGIN
  SELECT c.status
    INTO v_campaign_status
    FROM public.campaigns c
   WHERE c.id = p_campaign_id
     AND c.org_id = v_org_id
   FOR SHARE;

  IF v_campaign_status IS DISTINCT FROM 'active' THEN
    RETURN;
  END IF;

  SELECT c.*
    INTO v_contact
    FROM public.contacts c
   WHERE c.org_id = v_org_id
     AND c.campaign_id = p_campaign_id
     AND c.do_not_call = false
     AND c.attempts_count < 3
     AND (c.last_attempt_at IS NULL OR c.last_attempt_at <= clock_timestamp() - interval '4 hours')
     AND (clock_timestamp() AT TIME ZONE c.timezone)::time >= time '09:00'
     AND (clock_timestamp() AT TIME ZONE c.timezone)::time < time '20:00'
     AND NOT EXISTS (
       SELECT 1
         FROM public.call_attempts a
        WHERE a.contact_id = c.id
          AND a.status IN ('queued', 'dialing', 'in_progress')
     )
   ORDER BY c.last_attempt_at NULLS FIRST, c.id
   FOR UPDATE OF c SKIP LOCKED
   LIMIT 1;

  IF NOT FOUND THEN
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

REVOKE ALL ON FUNCTION app_private.on_call_attempt_terminal() FROM PUBLIC;
CREATE TRIGGER call_attempts_terminal_effects
AFTER UPDATE OF status ON public.call_attempts
FOR EACH ROW EXECUTE FUNCTION app_private.on_call_attempt_terminal();

COMMIT;
