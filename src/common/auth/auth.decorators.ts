import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Request } from 'express';

export const IS_PUBLIC_KEY = 'isPublic';
export const AUTH_RATE_LIMIT_KEY = 'authRateLimit';

/** Opens a route to unauthenticated callers (the JWT guard is global). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Applies the stricter `auth` throttler (login, register, password reset...). */
export const AuthRateLimit = () => SetMetadata(AUTH_RATE_LIMIT_KEY, true);

/** Identity extracted from a verified access token. Never read the user id from the body. */
export interface AuthUser {
  id: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
