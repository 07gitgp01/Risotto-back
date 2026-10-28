import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTokensValidAfter1793166717953 implements MigrationInterface {
  name = 'AddTokensValidAfter1793166717953';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "tokens_valid_after" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "tokens_valid_after"`);
  }
}
