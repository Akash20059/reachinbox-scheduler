import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

interface SenderAccount {
  host: string;
  port: number;
  user: string;
  pass: string;
  name: string;
  email: string;
}

const transporters = new Map<string, Transporter>();

export function getTransporter(sender: SenderAccount): Transporter {
  const cacheKey = `${sender.host}:${sender.port}:${sender.user}`;
  let transporter = transporters.get(cacheKey);

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: sender.host,
      port: sender.port,
      secure: sender.port === 465,
      auth: {
        user: sender.user,
        pass: sender.pass,
      },
    });
    transporters.set(cacheKey, transporter);
  }

  return transporter;
}

export async function sendEmailViaSender(
  sender: SenderAccount,
  emailData: {
    to: string;
    subject: string;
    body: string;
  }
) {
  const transporter = getTransporter(sender);

  const info = await transporter.sendMail({
    from: `"${sender.name}" <${sender.email}>`,
    to: emailData.to,
    subject: emailData.subject,
    html: emailData.body,
    text: emailData.body.replace(/<[^>]*>/g, ''), // Plaintext fallback
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);
  return {
    messageId: info.messageId,
    previewUrl: previewUrl || undefined,
  };
}
