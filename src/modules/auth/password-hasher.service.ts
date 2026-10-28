import { hash, verify } from '@node-rs/argon2';
import { Injectable, OnModuleInit } from '@nestjs/common';

/** argon2id with the library defaults (OWASP: m=19 MiB, t=2, p=1). */
@Injectable()
export class PasswordHasher implements OnModuleInit {
  // Verified when the email is unknown, so that login takes the same time either way.
  private dummyHash: string;

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hash('risotto-timing-equalizer');
  }

  hash(password: string): Promise<string> {
    return hash(password);
  }

  async verify(passwordHash: string | undefined, password: string): Promise<boolean> {
    try {
      const matches = await verify(passwordHash ?? this.dummyHash, password);
      return passwordHash !== undefined && matches;
    } catch {
      return false;
    }
  }
}
