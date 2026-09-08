import { Injectable, Logger } from '@nestjs/common';
import { paymentSecretEmailTemplate } from './email-templates';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async sendPaymentSecretEmail(data: {
    email: string;
    name: string;
    paymentSecret: string;
    expiresAt: string;
  }): Promise<void> {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      throw new Error('SMTP_HOST, SMTP_USER and SMTP_PASS are required');
    }

    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    await transporter.sendMail({
      from: SMTP_FROM || `PayAssure <${SMTP_USER}>`,
      to: data.email,
      subject: 'PayAssure registration successful',
      html: paymentSecretEmailTemplate(data),
    });

    this.logger.log(`Payment secret email sent to ${data.email}`);
  }
}