import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type UserRole = 'member' | 'admin';

@Entity({ name: 'users' })
@Check('CHK_users_role', `"role" IN ('member', 'admin')`)
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Stored lower-cased; citext makes the unique index case-insensitive anyway. */
  @Column({ type: 'citext', unique: true })
  email: string;

  @Column({ name: 'password_hash', type: 'text', select: false })
  passwordHash: string;

  /** Access tokens issued up to this instant are refused (logout everywhere, new password). */
  @Column({ name: 'tokens_valid_after', type: 'timestamptz', nullable: true, select: false })
  tokensValidAfter: Date | null;

  /** Random, rotatable token encoded in the personal QR code (never the user id). */
  @Column({ name: 'qr_token', type: 'varchar', length: 64, nullable: true, unique: true })
  qrToken: string | null;

  /** Granted only from the command line (`npm run admin:grant`), never through the API. */
  @Column({ type: 'varchar', length: 16, default: 'member' })
  role: UserRole;

  /** Set by an admin: the account can no longer sign in. */
  @Column({ name: 'suspended_at', type: 'timestamptz', nullable: true })
  suspendedAt: Date | null;

  /** Last moment the user had the app open ("vu à 14 h 32"). */
  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  /** Online status and last seen are shared (and, in return, visible). */
  @Column({ name: 'share_presence', type: 'boolean', default: true })
  sharePresence: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
