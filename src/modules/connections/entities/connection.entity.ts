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

export const CONNECTION_STATUSES = ['pending', 'accepted', 'declined'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

/**
 * One row per pair of users, whoever asked first. The pair is stored ordered
 * (`userAId < userBId`) so the unique constraint covers both directions.
 */
@Entity({ name: 'connections' })
@Unique('UQ_connections_pair', ['userAId', 'userBId'])
export class Connection {
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

  @Index()
  @Column({ name: 'requester_id', type: 'uuid' })
  requesterId: string;

  @Index()
  @Column({ name: 'addressee_id', type: 'uuid' })
  addresseeId: string;

  @Column({
    type: 'enum',
    enum: CONNECTION_STATUSES,
    enumName: 'connection_status',
    default: 'pending',
  })
  status: ConnectionStatus;

  /** Optional note sent with the request. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  message: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt: Date | null;
}

export function orderedPair(first: string, second: string): [string, string] {
  return first < second ? [first, second] : [second, first];
}
