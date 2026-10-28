import { IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { IsNormalizedEmail } from '../../../common/validation/email';
import { IsStrongPassword, PASSWORD_MAX_LENGTH } from '../../../common/validation/password';
import { UserView } from '../../users/users.service';

export class RegisterDto {
  @IsNormalizedEmail()
  email: string;

  @IsStrongPassword()
  password: string;
}

export class LoginDto {
  @IsNormalizedEmail()
  email: string;

  // No policy check on login: only bound the size (old passwords may predate the policy).
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}

export class RefreshTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  refreshToken: string;
}

export class ForgotPasswordDto {
  @IsNormalizedEmail()
  email: string;
}

export class ResetPasswordDto {
  @IsNormalizedEmail()
  email: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code: string;

  @IsStrongPassword()
  newPassword: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  /** Access token lifetime in seconds. */
  expiresIn: number;
}

export interface AuthResponse extends AuthTokens {
  user: UserView;
}
