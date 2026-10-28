import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProfiles1793157441176 implements MigrationInterface {
  name = 'CreateProfiles1793157441176';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."profile_visibility" AS ENUM('public', 'connections', 'private')`,
    );
    await queryRunner.query(
      `CREATE TABLE "profiles" ("user_id" uuid NOT NULL, "first_name" character varying(50) NOT NULL, "last_name" character varying(50) NOT NULL, "headline" character varying(120), "job_title" character varying(100), "company" character varying(100), "bio" character varying(1000), "location" character varying(100), "phone" character varying(20), "website" character varying(200), "photo_key" character varying(64), "visibility" "public"."profile_visibility" NOT NULL DEFAULT 'connections', "share_email" boolean NOT NULL DEFAULT false, "share_phone" boolean NOT NULL DEFAULT false, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9e432b7df0d182f8d292902d1a2" PRIMARY KEY ("user_id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "profiles" ADD CONSTRAINT "FK_9e432b7df0d182f8d292902d1a2" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "profiles" DROP CONSTRAINT "FK_9e432b7df0d182f8d292902d1a2"`,
    );
    await queryRunner.query(`DROP TABLE "profiles"`);
    await queryRunner.query(`DROP TYPE "public"."profile_visibility"`);
  }
}
