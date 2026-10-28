import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../../config/configuration';
import { MailModule } from '../mail/mail.module';
import { User } from '../users/user.entity';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetCode } from './entities/password-reset-code.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordHasher } from './password-hasher.service';
import { PasswordResetService } from './password-reset.service';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([RefreshToken, PasswordResetCode, User]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const auth = config.getOrThrow<AppConfig['auth']>('auth');
        return {
          secret: auth.jwtAccessSecret,
          signOptions: { algorithm: 'HS256', expiresIn: auth.jwtAccessTtlSeconds },
          verifyOptions: { algorithms: ['HS256'] },
        };
      },
    }),
    UsersModule,
    MailModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokensService,
    PasswordHasher,
    PasswordResetService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [TokensService],
})
export class AuthModule {}
