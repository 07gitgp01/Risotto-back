import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { UserRole } from '../../users/user.entity';

export const ACCOUNT_STATUSES = ['active', 'suspended'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export class ListAccountsQuery {
  /** Matches the email or the name, accent- and case-insensitive. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(ACCOUNT_STATUSES)
  status?: AccountStatus;

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

export interface AdminAccountView {
  id: string;
  email: string;
  role: UserRole;
  /** Null when the member has not created a profile yet. */
  name: string | null;
  createdAt: string;
  suspendedAt: string | null;
}

export interface AdminAccountPage {
  total: number;
  items: AdminAccountView[];
}

export interface AdminStats {
  members: { total: number; suspended: number; newLast7Days: number; withProfile: number };
  connections: { accepted: number; pending: number };
  messaging: { conversations: number; messagesLast7Days: number };
}
