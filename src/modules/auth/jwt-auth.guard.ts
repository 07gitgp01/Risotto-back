import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest, IS_PUBLIC_KEY } from '../../common/auth/auth.decorators';
import { AccessTokenPayload, TokensService } from './tokens.service';

/** Global guard: every route requires a valid access token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException();
    }

    let payload: AccessTokenPayload;
    try {
      payload = this.tokens.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException();
    }
    if (!payload.sid || (await this.tokens.isAccessTokenRevoked(payload))) {
      throw new UnauthorizedException();
    }
    request.user = { id: payload.sub };
    return true;
  }
}
