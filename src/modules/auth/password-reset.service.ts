import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';
import { hmacSha256, randomDigits, safeEqualHex } from '../../common/crypto/hashing';
import { AppConfig } from '../../config/configuration';
import { MailService } from '../mail/mail.service';
import { RealtimeService } from '../realtime/realtime.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { ResetPasswordDto } from './dto/auth.dto';
import { PasswordResetCode } from './entities/password-reset-code.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { PasswordHasher } from './password-hasher.service';
import { TokensService } from './tokens.service';

const INVALID_CODE = 'Invalid or expired code';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly authConfig: AppConfig['auth'];

  constructor(
    config: ConfigService,
    private readonly dataSource: DataSource,
    @InjectRepository(PasswordResetCode) private readonly codes: Repository<PasswordResetCode>,
    private readonly users: UsersService,
    private readonly hasher: PasswordHasher,
    private readonly mail: MailService,
    private readonly realtime: RealtimeService,
    private readonly tokens: TokensService,
  ) {
    this.authConfig = config.getOrThrow<AppConfig['auth']>('auth');
  }

  /**
   * Emails a fresh code if the account exists. The caller always gets the same answer and
   * the email is sent in the background, so the response does not reveal whether it exists.
   */
  async requestCode(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user) {
      return;
    }

    // Only the latest code is valid.
    await this.codes.update({ userId: user.id, usedAt: IsNull() }, { usedAt: new Date() });

    const code = randomDigits(6);
    const ttlMinutes = this.authConfig.passwordResetTtlMinutes;
    await this.codes.insert({
      userId: user.id,
      codeHash: this.hashCode(code),
      expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
    });

    this.mail.sendPasswordResetCode(user.email, code, ttlMinutes).catch((error: unknown) => {
      this.logger.error(`Password reset email failed: ${String(error)}`);
    });
  }

  /** Sets the new password and signs the user out of every device. */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const user = await this.users.findByEmail(dto.email);
    const resetCode = user
      ? await this.codes.findOne({
          where: { userId: user.id, usedAt: IsNull(), expiresAt: MoreThan(new Date()) },
          order: { createdAt: 'DESC' },
        })
      : null;

    if (!user || !resetCode) {
      throw new BadRequestException(INVALID_CODE);
    }

    if (!safeEqualHex(resetCode.codeHash, this.hashCode(dto.code))) {
      await this.registerFailedAttempt(resetCode);
      throw new BadRequestException(INVALID_CODE);
    }

    const passwordHash = await this.hasher.hash(dto.newPassword);
    await this.dataSource.transaction(async (manager) => {
      // Consume the code atomically: a concurrent request with the same code gets nothing.
      const consumed = await manager.update(
        PasswordResetCode,
        { id: resetCode.id, usedAt: IsNull() },
        { usedAt: new Date() },
      );
      if (consumed.affected !== 1) {
        throw new BadRequestException(INVALID_CODE);
      }
      await manager.update(User, { id: user.id }, { passwordHash });
      await manager.update(
        RefreshToken,
        { userId: user.id, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
    });
    await this.tokens.revokeAccessTokensIssuedBefore(user.id, new Date());
    this.realtime.disconnectUser(user.id);
  }

  /** Atomic increment, so parallel guesses cannot exceed the attempt budget. */
  private async registerFailedAttempt(resetCode: PasswordResetCode): Promise<void> {
    await this.codes
      .createQueryBuilder()
      .update(PasswordResetCode)
      .set({
        failedAttempts: () => 'failed_attempts + 1',
        usedAt: () => 'CASE WHEN failed_attempts + 1 >= :max THEN now() ELSE used_at END',
      })
      .where('id = :id', { id: resetCode.id })
      .setParameter('max', this.authConfig.passwordResetMaxAttempts)
      .execute();
  }

  private hashCode(code: string): string {
    return hmacSha256(this.authConfig.tokenHashSecret, code);
  }
}
