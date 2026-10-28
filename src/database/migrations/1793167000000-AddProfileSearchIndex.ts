import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Member search: an IMMUTABLE text expression (required for an index) and a trigram
 * GIN index on it, so `LIKE '%term%'` stays fast with many profiles. Company and job
 * title are only searchable on public profiles (they are hidden from strangers).
 */
export class AddProfileSearchIndex1793167000000 implements MigrationInterface {
  name = 'AddProfileSearchIndex1793167000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION profile_search_text(
        visibility profile_visibility, first_name text, last_name text, headline text,
        job_title text, company text
      ) RETURNS text
      LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
        SELECT public.unaccent('public.unaccent'::regdictionary, lower(
          CASE WHEN visibility = 'public'
            THEN concat_ws(' ', first_name, last_name, headline, job_title, company)
            ELSE concat_ws(' ', first_name, last_name, headline)
          END
        ))
      $$`);
    await queryRunner.query(`
      CREATE INDEX "IDX_profiles_search" ON "profiles" USING GIN (
        profile_search_text(visibility, first_name, last_name, headline, job_title, company)
        gin_trgm_ops
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_profiles_search"`);
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS profile_search_text(profile_visibility, text, text, text, text, text)`,
    );
    await queryRunner.query(`DROP EXTENSION IF EXISTS pg_trgm`);
  }
}
