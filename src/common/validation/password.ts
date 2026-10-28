import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const PASSWORD_MIN_LENGTH = 8;
// Bounded so that hashing stays cheap for the server (argon2 DoS).
export const PASSWORD_MAX_LENGTH = 128;

/** Password policy: 8 to 128 characters, at least one letter and one digit. */
export function IsStrongPassword() {
  return applyDecorators(
    IsString(),
    MinLength(PASSWORD_MIN_LENGTH),
    MaxLength(PASSWORD_MAX_LENGTH),
    Matches(/\p{L}/u, { message: 'password must contain at least one letter' }),
    Matches(/\d/, { message: 'password must contain at least one digit' }),
  );
}
