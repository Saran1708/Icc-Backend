// utils/mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host:   process.env.MAIL_HOST,
  port:   Number(process.env.MAIL_PORT) || 465,
  secure: process.env.MAIL_SECURE === 'true',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

transporter.verify((err) => {
  if (err) console.error('❌ SMTP connection failed:', err.message);
  else     console.log('✅ SMTP ready');
});

/**
 * Send an email (awaited — low-level)
 */
async function sendMail(to, toName, subject, html) {
  try {
    await transporter.sendMail({
      from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM_EMAIL}>`,
      to:   `"${toName}" <${to}>`,
      subject,
      html,
      text: html.replace(/<[^>]+>/g, ''),
    });
    return true;
  } catch (err) {
    console.error(`❌ Mail send failed to ${to}:`, err.message);
    return false;
  }
}

/**
 * Fire-and-forget — use this in your routes so the response
 * is NEVER blocked by mail sending. Responds to user instantly.
 *
 * Usage in your route:
 *   sendMailBackground(email, name, subject, html);
 *   res.json({ success: true });  // returns immediately, mail sends in background
 */
function sendMailBackground(to, toName, subject, html) {
  sendMail(to, toName, subject, html).catch((err) =>
    console.error(`❌ Background mail failed to ${to}:`, err.message)
  );
}

// ── Brand tokens (from your CSS variables) ───────────────────────────────────
// --background : hsl(0 0% 4%)    → #0a0a0a
// --card       : hsl(0 0% 8%)    → #141414
// --dark-card  : hsl(0 0% 10%)   → #1a1a1a
// --border     : hsl(0 0% 18%)   → #2e2e2e
// --cream      : hsl(40 30% 90%) → #ede8df  (--primary)
// --cream-dark : hsl(35 20% 75%) → #c9bfad  (--accent)
// --text-muted : hsl(0 0% 55%)   → #8c8c8c
const B = {
  bg:        '#0a0a0a',
  card:      '#141414',
  cardAlt:   '#1a1a1a',
  border:    '#2e2e2e',
  cream:     '#ede8df',
  creamDark: '#c9bfad',
  muted:     '#8c8c8c',
  white:     '#f5f5f5',
  font:      "'DM Sans', Arial, sans-serif",
};

// ── Shared shell wrapper ─────────────────────────────────────────────────────
function shell(content) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
</head>
<body style="margin:0;padding:0;background-color:${B.bg};font-family:${B.font};">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:${B.bg};padding:48px 16px;">
    <tr>
      <td align="center">
        <table width="540" cellpadding="0" cellspacing="0" style="max-width:540px;width:100%;">

          <!-- Brand bar -->
          <tr>
            <td style="background-color:${B.cardAlt};border-radius:12px 12px 0 0;padding:22px 36px;border-bottom:1px solid ${B.border};">
              <p style="margin:0;font-size:11px;letter-spacing:5px;text-transform:uppercase;color:${B.cream};font-weight:600;font-family:${B.font};">
                ${process.env.MAIL_FROM_NAME}
              </p>
            </td>
          </tr>

          ${content}

          <!-- Footer -->
          <tr>
            <td style="background-color:${B.cardAlt};border-radius:0 0 12px 12px;padding:24px 36px;text-align:center;border-top:1px solid ${B.border};">
              <p style="margin:0 0 8px;font-size:12px;color:${B.muted};line-height:1.6;font-family:${B.font};">
                You're receiving this because you have an account with ${process.env.MAIL_FROM_NAME}.
              </p>
              <p style="margin:0;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${B.cream};font-weight:500;font-family:${B.font};">
                ${process.env.MAIL_FROM_NAME}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Templates ────────────────────────────────────────────────────────────────

function otpEmailTemplate(name, otp) {
  const body = `
    <tr>
      <td style="background-color:${B.card};padding:44px 36px 40px;">
        <div style="width:40px;height:2px;background:${B.cream};margin-bottom:28px;"></div>
        <h1 style="margin:0 0 12px;font-size:26px;font-weight:600;color:${B.white};line-height:1.3;font-family:${B.font};">
          Verify your email
        </h1>
        <p style="margin:0 0 32px;font-size:15px;color:${B.muted};line-height:1.7;font-family:${B.font};">
          Hi ${name}, use the one-time code below to complete your registration.
          It expires in <strong style="color:${B.creamDark};">10 minutes</strong>.
        </p>

        <!-- OTP box -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
          <tr>
            <td style="background-color:${B.cardAlt};border:1px solid ${B.border};border-radius:10px;padding:32px;text-align:center;">
              <p style="margin:0 0 10px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${B.muted};font-weight:500;font-family:${B.font};">
                One-time code
              </p>
              <p style="margin:0;font-size:52px;font-weight:700;letter-spacing:18px;color:${B.cream};font-family:${B.font};">
                ${otp}
              </p>
            </td>
          </tr>
        </table>

        <p style="margin:0;font-size:13px;color:${B.muted};line-height:1.6;font-family:${B.font};">
          Didn't create an account? You can safely ignore this email — no action is needed.
        </p>
      </td>
    </tr>`;
  return shell(body);
}

function welcomeEmailTemplate(name) {
  const steps = [
    { n: '01', title: 'Complete your profile',  desc: 'Add your details to personalise your experience.' },
    { n: '02', title: 'Explore the platform',   desc: 'Discover all the tools and features available to you.' },
    { n: '03', title: 'Need help?',              desc: 'Our support team is always here — reach out anytime.' },
  ];

  const stepsHtml = steps.map(s => `
    <tr>
      <td style="padding-bottom:20px;vertical-align:top;">
        <table cellpadding="0" cellspacing="0">
          <tr>
            <td style="width:44px;padding-right:0;vertical-align:top;padding-top:2px;">
              <p style="margin:0;font-size:11px;font-weight:700;color:${B.cream};letter-spacing:1px;font-family:${B.font};">${s.n}</p>
            </td>
            <td style="border-left:1px solid ${B.border};padding-left:18px;">
              <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:${B.white};font-family:${B.font};">${s.title}</p>
              <p style="margin:0;font-size:13px;color:${B.muted};line-height:1.6;font-family:${B.font};">${s.desc}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`).join('');

  const body = `
    <tr>
      <td style="background-color:${B.card};padding:44px 36px 40px;">
        <div style="width:40px;height:2px;background:${B.cream};margin-bottom:28px;"></div>
        <h1 style="margin:0 0 12px;font-size:28px;font-weight:600;color:${B.white};line-height:1.3;font-family:${B.font};">
          Welcome, ${name}.
        </h1>
        <p style="margin:0 0 32px;font-size:15px;color:${B.muted};line-height:1.7;font-family:${B.font};">
          Your email is verified and your account is fully activated.
          We're glad to have you on board — everything is ready to go.
        </p>
        <a href="${process.env.APP_URL}/login"
           style="display:inline-block;padding:14px 32px;background-color:${B.cream};color:#0a0a0a;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1.5px;border-radius:6px;text-transform:uppercase;font-family:${B.font};">
          Go to Dashboard &rarr;
        </a>
      </td>
    </tr>

    <!-- What's next -->
    <tr>
      <td style="background-color:${B.cardAlt};border-top:1px solid ${B.border};border-bottom:1px solid ${B.border};padding:32px 36px;">
        <p style="margin:0 0 24px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${B.creamDark};font-weight:600;font-family:${B.font};">
          What's next
        </p>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${stepsHtml}
        </table>
      </td>
    </tr>`;
  return shell(body);
}

function passwordResetEmailTemplate(name, resetLink) {
  const body = `
    <tr>
      <td style="background-color:${B.card};padding:44px 36px 40px;">
        <div style="width:40px;height:2px;background:${B.cream};margin-bottom:28px;"></div>
        <h1 style="margin:0 0 12px;font-size:26px;font-weight:600;color:${B.white};line-height:1.3;font-family:${B.font};">
          Reset your password
        </h1>
        <p style="margin:0 0 32px;font-size:15px;color:${B.muted};line-height:1.7;font-family:${B.font};">
          Hi ${name}, we received a request to reset your password.
          Click below to proceed — this link expires in <strong style="color:${B.creamDark};">1 hour</strong>.
        </p>
        <a href="${resetLink}"
           style="display:inline-block;padding:14px 32px;background-color:${B.cream};color:#0a0a0a;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1.5px;border-radius:6px;text-transform:uppercase;font-family:${B.font};">
          Reset Password &rarr;
        </a>

        <!-- Security note -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;">
          <tr>
            <td style="background-color:${B.cardAlt};border:1px solid ${B.border};border-radius:8px;padding:16px 20px;">
              <p style="margin:0;font-size:13px;color:${B.muted};line-height:1.6;font-family:${B.font};">
                🔒 <strong style="color:${B.creamDark};">Security tip:</strong>
                We will never ask for your password via email.
                If you didn't request this reset, simply ignore this email — your password won't change.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
  return shell(body);
}

module.exports = {
  sendMail,
  sendMailBackground,   // ← swap all your route usages to this
  otpEmailTemplate,
  welcomeEmailTemplate,
  passwordResetEmailTemplate,
};