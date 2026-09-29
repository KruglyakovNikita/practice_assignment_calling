DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auto_calling_app') THEN
    CREATE ROLE auto_calling_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auto_calling_service') THEN
    CREATE ROLE auto_calling_service LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
  END IF;
END
$$;

ALTER ROLE auto_calling_app PASSWORD :'app_password';
ALTER ROLE auto_calling_service PASSWORD :'service_password';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO auto_calling_app, auto_calling_service;
