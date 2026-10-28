import {
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export const PROFILE_VISIBILITIES = ['public', 'connections', 'private'] as const;
export type ProfileVisibility = (typeof PROFILE_VISIBILITIES)[number];

@Entity({ name: 'profiles' })
// Expression index managed by its migration (TypeORM cannot describe it).
@Index('IDX_profiles_search', { synchronize: false })
export class Profile {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'first_name', type: 'varchar', length: 50 })
  firstName: string;

  @Column({ name: 'last_name', type: 'varchar', length: 50 })
  lastName: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  headline: string | null;

  @Column({ name: 'job_title', type: 'varchar', length: 100, nullable: true })
  jobTitle: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  company: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  bio: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  location: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  website: string | null;

  /** File name in UPLOAD_DIR; changes on every upload (cache busting). */
  @Column({ name: 'photo_key', type: 'varchar', length: 64, nullable: true })
  photoKey: string | null;

  @Column({
    type: 'enum',
    enum: PROFILE_VISIBILITIES,
    enumName: 'profile_visibility',
    default: 'connections',
  })
  visibility: ProfileVisibility;

  @Column({ name: 'share_email', type: 'boolean', default: false })
  shareEmail: boolean;

  @Column({ name: 'share_phone', type: 'boolean', default: false })
  sharePhone: boolean;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
