import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserRoleAndSuspension1793170000000 implements MigrationInterface {
  name = 'AddUserRoleAndSuspension1793170000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "role" character varying(16) NOT NULL DEFAULT 'member'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_role" CHECK ("role" IN ('member', 'admin'))`,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD "suspended_at" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "suspended_at"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "CHK_users_role"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "role"`);
  }
}
