import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { AppConfig } from '../../config/configuration';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Sends transactional emails over SMTP (Mailpit in local). */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    const mail = config.getOrThrow<AppConfig['mail']>('mail');
    this.from = mail.from;
    this.transporter = createTransport({
      host: mail.host,
      port: mail.port,
      secure: mail.secure,
      auth: mail.user ? { user: mail.user, pass: mail.password } : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...message });
    // Never log the content: it may hold a reset code.
    this.logger.log(`Email "${message.subject}" sent`);
  }

  sendPasswordResetCode(to: string, code: string, ttlMinutes: number): Promise<void> {
    return this.send(buildPasswordResetMessage(to, code, ttlMinutes));
  }
}

export function buildPasswordResetMessage(
  to: string,
  code: string,
  ttlMinutes: number,
): MailMessage {
  return {
    to,
    subject: 'Risotto : votre code de réinitialisation',
    text: [
      'Bonjour,',
      '',
      `Votre code pour réinitialiser votre mot de passe Risotto : ${code}`,
      '',
      `Il est valable ${ttlMinutes} minutes et ne peut servir qu'une seule fois.`,
      "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe reste inchangé.",
    ].join('\n'),
  };
}
