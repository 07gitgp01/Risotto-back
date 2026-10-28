import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ProfileView } from '../../profiles/profile-view';
import { ConnectionState } from '../../relationships/relationship.service';
import { ConnectionStatus } from '../entities/connection.entity';

const trimToNull = () =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') {
      return value;
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  });

/** Target by user id (from search or a profile) or by scanned QR payload: exactly one. */
export class CreateConnectionDto {
  @ValidateIf((dto: CreateConnectionDto) => dto.qrPayload === undefined)
  @IsUUID()
  userId?: string;

  @ValidateIf((dto: CreateConnectionDto) => dto.userId === undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  qrPayload?: string;

  @IsOptional()
  @trimToNull()
  @IsString()
  @MaxLength(300)
  message?: string | null;
}

export class PaginationQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;
}

export class ListRequestsQuery extends PaginationQuery {
  @IsIn(['incoming', 'outgoing'])
  direction: 'incoming' | 'outgoing';
}

export class SearchQuery {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;
}

export class BlockUserDto {
  @IsUUID()
  userId: string;
}

export interface ConnectionView {
  id: string;
  status: ConnectionStatus;
  /** From the current user's point of view. */
  direction: 'incoming' | 'outgoing';
  message: string | null;
  createdAt: string;
  respondedAt: string | null;
  /** The other user. */
  user: ProfileView;
}

export interface SearchResult extends ProfileView {
  connection: ConnectionState;
}

export interface BlockedUserView {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  blockedAt: string;
}
