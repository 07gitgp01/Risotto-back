import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Profile photos move from the local disk to PostgreSQL. Files already on disk are
 * not imported: their profiles are reset to "no photo" so nothing points to a
 * missing image.
 */
export class CreateProfilePhotos1793180000000 implements MigrationInterface {
  name = 'CreateProfilePhotos1793180000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "profile_photos" ("user_id" uuid NOT NULL, "key" character varying(64) NOT NULL, "data" bytea NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_profile_photos_user_id" PRIMARY KEY ("user_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_profile_photos_key" ON "profile_photos" ("key")`,
    );
    await queryRunner.query(
      `ALTER TABLE "profile_photos" ADD CONSTRAINT "FK_profile_photos_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`UPDATE "profiles" SET "photo_key" = NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "profiles" SET "photo_key" = NULL`);
    await queryRunner.query(`DROP TABLE "profile_photos"`);
  }
}
