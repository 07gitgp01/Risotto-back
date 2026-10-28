import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthRateLimit, AuthUser, CurrentUser, Public } from '../../common/auth/auth.decorators';
import { AuthService } from './auth.service';
import {
  AuthResponse,
  AuthTokens,
  ForgotPasswordDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { PasswordResetService } from './password-reset.service';

@AuthRateLimit()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Public()
  @Post('register')
  register(
    @Body() dto: RegisterDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AuthResponse> {
    return this.auth.register(dto, userAgent);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Headers('user-agent') userAgent?: string): Promise<AuthResponse> {
    return this.auth.login(dto, userAgent);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(
    @Body() dto: RefreshTokenDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AuthTokens> {
    return this.auth.refresh(dto.refreshToken, userAgent);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@CurrentUser() user: AuthUser, @Body() dto: RefreshTokenDto): Promise<void> {
    return this.auth.logout(user.id, dto.refreshToken);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  logoutAll(@CurrentUser() user: AuthUser): Promise<void> {
    return this.auth.logoutAll(user.id);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    return this.passwordReset.requestCode(dto.email);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.passwordReset.resetPassword(dto);
  }
}
