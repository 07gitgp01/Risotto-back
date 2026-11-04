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
@Index('UQ_messages_sender_client', ['senderId', 'clientId'], { unique: true })
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

  /** Chosen by the sending device: retrying a send never creates a duplicate. */
  @Column({ name: 'client_id', type: 'uuid', nullable: true })
  clientId: string | null;

  /** Message this one answers (quoted above the bubble). */
  @Column({ name: 'reply_to_id', type: 'uuid', nullable: true })
  replyToId: string | null;

  @ManyToOne(() => Message, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reply_to_id', foreignKeyConstraintName: 'FK_messages_reply_to' })
  replyTo?: Message | null;

  @Column({ name: 'edited_at', type: 'timestamptz', nullable: true })
  editedAt: Date | null;

  /** Deleted for everyone: the encrypted body is wiped, only this marker stays. */
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
