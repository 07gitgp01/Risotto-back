import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from '../../users/user.entity';
import { Message } from './message.entity';

/** One emoji per member and message (a new one replaces the previous). */
@Entity({ name: 'message_reactions' })
export class MessageReaction {
  @PrimaryColumn({
    name: 'message_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_message_reactions',
  })
  messageId: string;

  @PrimaryColumn({
    name: 'user_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_message_reactions',
  })
  userId: string;

  @ManyToOne(() => Message, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id', foreignKeyConstraintName: 'FK_message_reactions_message' })
  message?: Message;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_message_reactions_user' })
  user?: User;

  @Column({ type: 'varchar', length: 32 })
  emoji: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
