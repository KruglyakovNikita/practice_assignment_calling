INSERT INTO app_private.settings(key, value)
VALUES ('jwt_secret', :'jwt_secret')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
