import { Injectable, UnauthorizedException } from '@nestjs/common';
import { toUserView, UsersService } from '../users/users.service';
import { AuthResponse, AuthTokens, LoginDto, RegisterDto } from './dto/auth.dto';
import { PasswordHasher } from './password-hasher.service';
import { TokensService } from './tokens.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokensService,
  ) {}

  async register(dto: RegisterDto, userAgent?: string): Promise<AuthResponse> {
    const user = await this.users.create(dto.email, await this.hasher.hash(dto.password));
    const tokens = await this.tokens.issueForNewSession(user.id, userAgent);
    return { ...tokens, user: toUserView(user) };
  }

  async login(dto: LoginDto, userAgent?: string): Promise<AuthResponse> {
    const user = await this.users.findByEmailWithPassword(dto.email);
    // Same message and same work whether the email exists or not (no account enumeration).
    const valid = await this.hasher.verify(user?.passwordHash, dto.password);
    if (!user || !valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const tokens = await this.tokens.issueForNewSession(user.id, userAgent);
    return { ...tokens, user: toUserView(user) };
  }

  refresh(refreshToken: string, userAgent?: string): Promise<AuthTokens> {
    return this.tokens.rotate(refreshToken, userAgent);
  }

  logout(userId: string, refreshToken: string): Promise<void> {
    return this.tokens.revokeSession(userId, refreshToken);
  }

  logoutAll(userId: string): Promise<void> {
    return this.tokens.revokeAllForUser(userId);
  }
}
