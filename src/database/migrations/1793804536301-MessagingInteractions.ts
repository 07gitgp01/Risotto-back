import { MigrationInterface, QueryRunner } from 'typeorm';

export class MessagingInteractions1793804536301 implements MigrationInterface {
  name = 'MessagingInteractions1793804536301';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "message_reactions" ("message_id" uuid NOT NULL, "user_id" uuid NOT NULL, "emoji" character varying(32) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_message_reactions" PRIMARY KEY ("message_id", "user_id"))`,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD "last_seen_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "share_presence" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(`ALTER TABLE "messages" ADD "client_id" uuid`);
    await queryRunner.query(`ALTER TABLE "messages" ADD "reply_to_id" uuid`);
    await queryRunner.query(`ALTER TABLE "messages" ADD "edited_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "messages" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_messages_sender_client" ON "messages" ("sender_id", "client_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD CONSTRAINT "FK_messages_reply_to" FOREIGN KEY ("reply_to_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_reactions" ADD CONSTRAINT "FK_message_reactions_message" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_reactions" ADD CONSTRAINT "FK_message_reactions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "message_reactions" DROP CONSTRAINT "FK_message_reactions_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_reactions" DROP CONSTRAINT "FK_message_reactions_message"`,
    );
    await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "FK_messages_reply_to"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_messages_sender_client"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "deleted_at"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "edited_at"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "reply_to_id"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "client_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "share_presence"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "last_seen_at"`);
    await queryRunner.query(`DROP TABLE "message_reactions"`);
  }
}
