import nodemailer from "nodemailer";

export async function sendAuthMail(to: string, subject: string, text: string) {
  const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, AUTH_EMAIL_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !AUTH_EMAIL_FROM) {
    throw new Error("Account email delivery is not configured. Contact support.");
  }
  const port = Number(process.env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: SMTP_HOST, port, secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });
  await transport.sendMail({ from: AUTH_EMAIL_FROM, to, subject, text });
}
