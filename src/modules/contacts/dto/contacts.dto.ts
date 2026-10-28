import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ConnectionState } from '../../relationships/relationship.service';
import { ContactCard } from '../contact-card';

export class ScanQrDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  payload: string;

  /** Keep the card in my contacts (otherwise only preview it). */
  @IsOptional()
  @IsBoolean()
  saveContact?: boolean;
}

export class UpdateContactDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') {
      return value;
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  })
  @IsString()
  @MaxLength(500)
  note: string | null;
}

export interface QrCodeView {
  token: string;
  /** Exact string to encode in the QR code. */
  payload: string;
}

export interface ScanResult {
  card: ContactCard;
  isSelf: boolean;
  saved: boolean;
  /** Lets the app offer "connect" right after a scan. */
  connection: ConnectionState;
}

export interface SavedContactView {
  card: ContactCard;
  note: string | null;
  savedAt: string;
}
