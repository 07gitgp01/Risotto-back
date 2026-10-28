import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/user.entity';

/**
 * One-to-one conversation. The pair is stored ordered (`userAId < userBId`); each side
 * has its own read marker, which drives unread counts and read receipts.
 */
@Entity({ name: 'conversations' })
@Unique('UQ_conversations_pair', ['userAId', 'userBId'])
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_a_id', type: 'uuid' })
  userAId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_a_id' })
  userA?: User;

  @Index()
  @Column({ name: 'user_b_id', type: 'uuid' })
  userBId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_b_id' })
  userB?: User;

  @Column({ name: 'user_a_last_read_at', type: 'timestamptz', nullable: true })
  userALastReadAt: Date | null;

  @Column({ name: 'user_b_last_read_at', type: 'timestamptz', nullable: true })
  userBLastReadAt: Date | null;

  @Column({ name: 'last_message_at', type: 'timestamptz', nullable: true })
  lastMessageAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
