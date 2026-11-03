import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

/**
 * Normalized profile photo (WebP, 512 px max), one per user. Kept in PostgreSQL
 * so the API needs no persistent disk (hosted instances have an ephemeral one).
 */
@Entity({ name: 'profile_photos' })
export class ProfilePhoto {
  @PrimaryColumn({
    name: 'user_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_profile_photos_user_id',
  })
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_profile_photos_user' })
  user?: User;

  /** Same value as `profiles.photo_key`; changes on every upload (cache busting). */
  @Index('UQ_profile_photos_key', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  key: string;

  @Column({ type: 'bytea' })
  data: Buffer;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
