import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/user.entity';

/** 6-digit code emailed to reset a password. Single use, short-lived, limited attempts. */
@Entity({ name: 'password_reset_codes' })
export class PasswordResetCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  /** HMAC-SHA256 of the code (keyed with TOKEN_HASH_SECRET): a DB dump alone cannot brute-force it. */
  @Column({ name: 'code_hash', type: 'char', length: 64 })
  codeHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @Column({ name: 'failed_attempts', type: 'int', default: 0 })
  failedAttempts: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
