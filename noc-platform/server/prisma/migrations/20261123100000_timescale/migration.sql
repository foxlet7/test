-- Use TimescaleDB for the time series when the server has it (the docker-compose image does);
-- on plain PostgreSQL this is a no-op and Measurement stays an ordinary indexed table.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') THEN
    CREATE EXTENSION IF NOT EXISTS timescaledb;
    PERFORM create_hypertable('"Measurement"', 'ts', migrate_data => true, if_not_exists => true);
  END IF;
END
$$;
