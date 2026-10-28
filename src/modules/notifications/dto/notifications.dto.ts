import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ProfileView } from '../../profiles/profile-view';
import { DEVICE_PLATFORMS, DevicePlatform } from '../entities/device-token.entity';
import { NOTIFICATION_TYPE_NAMES, NotificationType } from '../notification-types';

export class NotificationsQuery {
  /** Id of the oldest notification already loaded. */
  @IsOptional()
  @IsUUID()
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 30;
}

export class PreferenceDto {
  @IsIn(NOTIFICATION_TYPE_NAMES)
  type: NotificationType;

  @IsOptional()
  @IsBoolean()
  inApp?: boolean;

  @IsOptional()
  @IsBoolean()
  push?: boolean;
}

export class UpdatePreferencesDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PreferenceDto)
  preferences: PreferenceDto[];
}

export class RegisterDeviceDto {
  @IsString()
  @MinLength(10)
  @MaxLength(4096)
  token: string;

  @IsIn(DEVICE_PLATFORMS)
  platform: DevicePlatform;
}

export class RemoveDeviceDto {
  @IsString()
  @MinLength(10)
  @MaxLength(4096)
  token: string;
}

export interface NotificationView {
  id: string;
  type: NotificationType;
  /** The member who triggered it, as the recipient may see them. */
  actor: ProfileView | null;
  data: Record<string, string>;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  notifications: NotificationView[];
  nextCursor: string | null;
  unreadCount: number;
}

export interface PreferenceView {
  type: NotificationType;
  inApp: boolean;
  push: boolean;
  /** False for types that never appear in the list (e.g. messages). */
  supportsInApp: boolean;
}
