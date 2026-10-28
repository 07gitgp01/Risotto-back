import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { setupApp } from './setup-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Behind Docker / a local proxy the client IP comes from X-Forwarded-For (rate limiting).
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  setupApp(app);
  await app.listen(app.get(ConfigService).getOrThrow<number>('port'));
}

void bootstrap();
