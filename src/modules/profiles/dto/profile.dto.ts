import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PROFILE_VISIBILITIES, ProfileVisibility } from '../profile.entity';

/** Trims strings; an empty optional string clears the field (null). */
const trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
const trimToNull = () =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') {
      return value;
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  });

/** Optional, but null is validated (and rejected) instead of skipped like @IsOptional. */
const OptionalNotNull = () => ValidateIf((_dto: object, value: unknown) => value !== undefined);

const PHONE = /^\+?[0-9][0-9 .()-]{5,19}$/;

class ProfileFieldsDto {
  @IsOptional()
  @trimToNull()
  @IsString()
  @MaxLength(120)
  headline?: string | null;

  @IsOptional()
  @trimToNull()
  @IsString()
  @MaxLength(100)
  jobTitle?: string | null;

  @IsOptional()
  @trimToNull()
  @IsString()
  @MaxLength(100)
  company?: string | null;

  @IsOptional()
  @trimToNull()
  @IsString()
  @MaxLength(1000)
  bio?: string | null;

  @IsOptional()
  @trimToNull()
  @IsString()
  @MaxLength(100)
  location?: string | null;

  @IsOptional()
  @trimToNull()
  @IsString()
  @Matches(PHONE, { message: 'phone must be a valid phone number' })
  @MaxLength(20)
  phone?: string | null;

  @IsOptional()
  @trimToNull()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(200)
  website?: string | null;

  @OptionalNotNull()
  @IsIn(PROFILE_VISIBILITIES)
  visibility?: ProfileVisibility;

  @OptionalNotNull()
  @IsBoolean()
  shareEmail?: boolean;

  @OptionalNotNull()
  @IsBoolean()
  sharePhone?: boolean;
}

export class CreateProfileDto extends ProfileFieldsDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  firstName: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  lastName: string;
}

export class UpdateProfileDto extends ProfileFieldsDto {
  @OptionalNotNull()
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  firstName?: string;

  @OptionalNotNull()
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  lastName?: string;
}
