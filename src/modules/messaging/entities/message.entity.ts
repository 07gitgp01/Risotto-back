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
import { Conversation } from './conversation.entity';

/** Message encrypted at rest (AES-256-GCM): the body is never stored in clear. */
@Entity({ name: 'messages' })
@Index('IDX_messages_conversation_created', ['conversationId', 'createdAt', 'id'])
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation?: Conversation;

  @Column({ name: 'sender_id', type: 'uuid' })
  senderId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sender_id' })
  sender?: User;

  @Column({ type: 'bytea' })
  ciphertext: Buffer;

  @Column({ type: 'bytea' })
  iv: Buffer;

  @Column({ name: 'auth_tag', type: 'bytea' })
  authTag: Buffer;

  @Column({ name: 'key_version', type: 'smallint' })
  keyVersion: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
