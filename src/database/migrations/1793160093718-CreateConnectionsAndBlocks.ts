import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateConnectionsAndBlocks1793160093718 implements MigrationInterface {
  name = 'CreateConnectionsAndBlocks1793160093718';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Accent-insensitive member search.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS unaccent`);
    await queryRunner.query(
      `CREATE TYPE "public"."connection_status" AS ENUM('pending', 'accepted', 'declined')`,
    );
    await queryRunner.query(
      `CREATE TABLE "connections" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_a_id" uuid NOT NULL, "user_b_id" uuid NOT NULL, "requester_id" uuid NOT NULL, "addressee_id" uuid NOT NULL, "status" "public"."connection_status" NOT NULL DEFAULT 'pending', "message" character varying(300), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "responded_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_connections_pair" UNIQUE ("user_a_id", "user_b_id"), CONSTRAINT "PK_0a1f844af3122354cbd487a8d03" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6231a53b5008c78392ef711a6e" ON "connections" ("user_b_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ebe9e7a9bbda233035e2f7a900" ON "connections" ("requester_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_59b1ba7c6b61966303fa607e56" ON "connections" ("addressee_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "blocks" ("blocker_id" uuid NOT NULL, "blocked_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_806f6a5d38d031cdd868fd5e37e" PRIMARY KEY ("blocker_id", "blocked_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8aa6c887bed61ad10829450f2f" ON "blocks" ("blocked_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "connections" ADD CONSTRAINT "FK_d5e2764cf7946f52be8ca174c13" FOREIGN KEY ("user_a_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "connections" ADD CONSTRAINT "FK_6231a53b5008c78392ef711a6ec" FOREIGN KEY ("user_b_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "blocks" ADD CONSTRAINT "FK_74f530c6fbffc357047b263818d" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "blocks" ADD CONSTRAINT "FK_8aa6c887bed61ad10829450f2f0" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "blocks" DROP CONSTRAINT "FK_8aa6c887bed61ad10829450f2f0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "blocks" DROP CONSTRAINT "FK_74f530c6fbffc357047b263818d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "connections" DROP CONSTRAINT "FK_6231a53b5008c78392ef711a6ec"`,
    );
    await queryRunner.query(
      `ALTER TABLE "connections" DROP CONSTRAINT "FK_d5e2764cf7946f52be8ca174c13"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_8aa6c887bed61ad10829450f2f"`);
    await queryRunner.query(`DROP TABLE "blocks"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_59b1ba7c6b61966303fa607e56"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ebe9e7a9bbda233035e2f7a900"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_6231a53b5008c78392ef711a6e"`);
    await queryRunner.query(`DROP TABLE "connections"`);
    await queryRunner.query(`DROP TYPE "public"."connection_status"`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS unaccent`);
  }
}
