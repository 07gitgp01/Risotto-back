import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitExtensions1761609600000 implements MigrationInterface {
  name = 'InitExtensions1761609600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // citext: case-insensitive emails (milestone 2).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS citext`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP EXTENSION IF EXISTS citext`);
  }
}
