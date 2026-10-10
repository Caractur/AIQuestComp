-- Runs once, on the first start of an empty data volume (before the snapshot below).
-- icr_test is used by the integration tests; its schema is dropped and recreated by them.
CREATE DATABASE icr_test;
\connect icr_test
CREATE EXTENSION IF NOT EXISTS vector;
