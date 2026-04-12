-- Sentinel — Database Initialization
-- Runs once on first container start (docker-entrypoint-initdb.d).
-- Creates extensions, schemas, and the uuidv7() polyfill.
-- Per-schema DDL lives in tools/migrations/{schema}/*.sql

-- Extensions (system-design.md §6.1)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- pg_partman for automated monthly partition management
CREATE EXTENSION IF NOT EXISTS "pg_partman" SCHEMA partman;

-- Domain schemas (one per bounded context)
CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS incident;
CREATE SCHEMA IF NOT EXISTS task;
CREATE SCHEMA IF NOT EXISTS document;
CREATE SCHEMA IF NOT EXISTS chat;
CREATE SCHEMA IF NOT EXISTS gis;
CREATE SCHEMA IF NOT EXISTS file;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS notification;

-- UUIDv7 polyfill (time-ordered UUID; native support coming in PostgreSQL 18)
-- High 48 bits = Unix timestamp in ms; next 4 bits = version 7; next 62 bits = random
CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
DECLARE
  unix_ts_ms bytea;
  uuid_bytes bytea;
BEGIN
  unix_ts_ms := substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3);
  uuid_bytes := unix_ts_ms || gen_random_bytes(10);
  uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & x'0f'::int) | x'70'::int);
  uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & x'3f'::int) | x'80'::int);
  RETURN encode(uuid_bytes, 'hex')::uuid;
END
$$ LANGUAGE plpgsql VOLATILE;

-- Reusable trigger function: auto-set updated_at on every UPDATE
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
