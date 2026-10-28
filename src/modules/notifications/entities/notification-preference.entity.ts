import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from '../../users/user.entity';

/** Only stored when the user changes a default (see NOTIFICATION_TYPES). */
@Entity({ name: 'notification_preferences' })
export class NotificationPreference {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @PrimaryColumn({ type: 'varchar', length: 40 })
  type: string;

  @Column({ name: 'in_app', type: 'boolean' })
  inApp: boolean;

  @Column({ type: 'boolean' })
  push: boolean;
}
