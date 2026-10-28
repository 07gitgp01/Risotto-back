import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

export interface RegisteredUser {
  id: string;
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
}

let counter = 0;

export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}.${Date.now()}.${counter}@example.com`;
}

export const VALID_PASSWORD = 'risotto-2026';

export async function registerUser(
  app: INestApplication<App>,
  email = uniqueEmail(),
  password = VALID_PASSWORD,
): Promise<RegisteredUser> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password })
    .expect(201);
  const body = res.body as {
    user: { id: string; email: string };
    accessToken: string;
    refreshToken: string;
  };
  return {
    id: body.user.id,
    email: body.user.email,
    password,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
  };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
