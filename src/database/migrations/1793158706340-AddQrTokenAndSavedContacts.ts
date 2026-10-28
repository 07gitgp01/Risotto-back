import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddQrTokenAndSavedContacts1793158706340 implements MigrationInterface {
  name = 'AddQrTokenAndSavedContacts1793158706340';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "saved_contacts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL, "contact_id" uuid NOT NULL, "note" character varying(500), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_saved_contacts_owner_contact" UNIQUE ("owner_id", "contact_id"), CONSTRAINT "PK_73e4e2c299319ac6029828a7081" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_980860499234f32047e133eb39" ON "saved_contacts" ("owner_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_28a275f4f4d90f6fe6bf38764c" ON "saved_contacts" ("contact_id") `,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD "qr_token" character varying(64)`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_5e95bf90c0c734b919826693774" UNIQUE ("qr_token")`,
    );
    await queryRunner.query(
      `ALTER TABLE "saved_contacts" ADD CONSTRAINT "FK_980860499234f32047e133eb393" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "saved_contacts" ADD CONSTRAINT "FK_28a275f4f4d90f6fe6bf38764ce" FOREIGN KEY ("contact_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "saved_contacts" DROP CONSTRAINT "FK_28a275f4f4d90f6fe6bf38764ce"`,
    );
    await queryRunner.query(
      `ALTER TABLE "saved_contacts" DROP CONSTRAINT "FK_980860499234f32047e133eb393"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "UQ_5e95bf90c0c734b919826693774"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "qr_token"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_28a275f4f4d90f6fe6bf38764c"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_980860499234f32047e133eb39"`);
    await queryRunner.query(`DROP TABLE "saved_contacts"`);
  }
}
