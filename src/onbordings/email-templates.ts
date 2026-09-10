export function paymentSecretEmailTemplate(data: {
  name: string;
  paymentSecret: string;
  expiresAt: string;
}) {
  const escapeHtml = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  return `
    <html lang="en">
      <body style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;">
          <h1 style="margin:0 0 16px;color:#0B1F3A;font-size:24px;">PayAssure registration successful</h1>
          <p>Hello ${escapeHtml(data.name)},</p>
          <p>Your payment method was registered successfully. Use the payment secret below to activate it:</p>
          <p style="padding:16px;background:#f1f5f9;border-radius:8px;font-size:18px;font-weight:700;letter-spacing:.5px;word-break:break-all;">${escapeHtml(data.paymentSecret)}</p>
          <p style="color:#475569;font-size:14px;">This secret expires on ${escapeHtml(data.expiresAt)}. Keep it private and do not share it.</p>
          <p>Thank you,<br />PayAssure</p>
        </div>
      </body>
    </html>
  `;
}