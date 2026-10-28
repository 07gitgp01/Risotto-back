import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { randomToken, sha256 } from '../../common/crypto/hashing';
import { AppConfig } from '../../config/configuration';
import { AuthTokens } from './dto/auth.dto';
import { RefreshToken } from './entities/refresh-token.entity';

export interface AccessTokenPayload {
  sub: string;
}

const INVALID_REFRESH_TOKEN = 'Invalid refresh token';

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);
  private readonly authConfig: AppConfig['auth'];

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
    @InjectRepository(RefreshToken) private readonly refreshTokens: Repository<RefreshToken>,
  ) {
    this.authConfig = config.getOrThrow<AppConfig['auth']>('auth');
  }

  /** Starts a new session (token family). */
  issueForNewSession(userId: string, userAgent?: string): Promise<AuthTokens> {
    return this.issue(userId, randomUUID(), userAgent);
  }

  /**
   * Rotates a refresh token: the presented token is consumed atomically and a new one is
   * issued in the same family. Reusing a consumed or revoked token revokes the whole family.
   */
  async rotate(refreshToken: string, userAgent?: string): Promise<AuthTokens> {
    const tokenHash = sha256(refreshToken);

    const consumed = await this.refreshTokens
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ usedAt: () => 'now()' })
      .where('token_hash = :tokenHash', { tokenHash })
      .andWhere('used_at IS NULL AND revoked_at IS NULL AND expires_at > now()')
      .returning('user_id, family_id')
      .execute();

    const row = (consumed.raw as { user_id: string; family_id: string }[])[0];
    if (row) {
      return this.issue(row.user_id, row.family_id, userAgent);
    }

    const existing = await this.refreshTokens.findOneBy({ tokenHash });
    if (existing && (existing.usedAt || existing.revokedAt)) {
      this.logger.warn(`Refresh token reuse detected, revoking family ${existing.familyId}`);
      await this.revokeFamily(existing.familyId);
    }
    throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
  }

  /** Ends the session the token belongs to, only if it belongs to `userId`. */
  async revokeSession(userId: string, refreshToken: string): Promise<void> {
    const token = await this.refreshTokens.findOneBy({ tokenHash: sha256(refreshToken), userId });
    if (token) {
      await this.revokeFamily(token.familyId);
    }
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshTokens.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    return this.jwt.verify<AccessTokenPayload>(token, { algorithms: ['HS256'] });
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.refreshTokens.update({ familyId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  private async issue(userId: string, familyId: string, userAgent?: string): Promise<AuthTokens> {
    const refreshToken = randomToken(32);
    const ttlMs = this.authConfig.refreshTokenTtlDays * 24 * 60 * 60 * 1000;

    await this.refreshTokens.insert({
      userId,
      familyId,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + ttlMs),
      userAgent: userAgent?.slice(0, 255) ?? null,
    });

    const payload: AccessTokenPayload = { sub: userId };
    return {
      accessToken: await this.jwt.signAsync(payload),
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.authConfig.jwtAccessTtlSeconds,
    };
  }
}
