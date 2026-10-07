import { Injectable } from '@nestjs/common';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  unsubscribeUrl: string;
}

export interface Mailer {
  send(mail: OutgoingEmail): Promise<{ id: string }>;
}
export const MAILER = Symbol('MAILER');

/** Sends through Resend (https://resend.com). The List-Unsubscribe headers let mail apps show a one-tap "unsubscribe". */
@Injectable()
export class ResendMailer implements Mailer {
  async send(mail: OutgoingEmail): Promise<{ id: string }> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.OUTREACH_FROM,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        headers: {
          'List-Unsubscribe': `<${mail.unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok || !body.id) throw new Error(`Email provider rejected the message: ${body.message ?? res.status}`);
    return { id: body.id };
  }
}
