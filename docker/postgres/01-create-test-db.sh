#!/bin/sh
# Creates the database used by the e2e tests next to the main one (first start only).
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  CREATE DATABASE "${DB_TEST_NAME:-risotto_test}" OWNER "$POSTGRES_USER";
SQL
