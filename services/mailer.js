const nodemailer = require('nodemailer');
const { logger } = require('../middlewares/logger');

// 创建邮件传输器（支持 QQ/163/Gmail/SMTP）
function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT) || 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    logger.warn('邮件服务未配置，忘记密码功能将使用开发模式');
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });
}

const transporter = createTransport();

async function sendPasswordReset(toEmail, resetToken, baseUrl) {
  const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

  // 没有配置 SMTP，开发模式直接返回 token
  if (!transporter) {
    logger.info(`[开发模式] 密码重置链接: ${resetUrl}`);
    return { dev: true, token: resetToken, url: resetUrl };
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await transporter.sendMail({
    from: `"FanBaaS" <${from}>`,
    to: toEmail,
    subject: '重置你的 FanBaaS 密码',
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"></head>
      <body style="font-family:Arial,sans-serif;background:#020b18;color:#e0f0ff;padding:40px 20px;">
        <div style="max-width:480px;margin:0 auto;background:#061d35;border:1px solid #0a3a5c;border-top:3px solid #00d4ff;border-radius:6px;padding:36px;">
          <h1 style="font-family:monospace;font-size:20px;color:#00d4ff;letter-spacing:3px;margin-bottom:8px;">FanBaaS</h1>
          <p style="color:#7aa8cc;font-size:13px;margin-bottom:24px;">Backend as a Service</p>
          <h2 style="font-size:16px;color:#e0f0ff;margin-bottom:16px;">重置密码</h2>
          <p style="color:#7aa8cc;font-size:14px;line-height:1.7;margin-bottom:24px;">
            你收到这封邮件是因为有人请求重置与此邮箱关联的 FanBaaS 账号密码。<br>
            如果不是你本人操作，请忽略此邮件。
          </p>
          <a href="${resetUrl}"
             style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#0066ff,#00d4ff);color:#fff;text-decoration:none;border-radius:3px;font-weight:bold;font-size:14px;letter-spacing:1px;">
            重置密码
          </a>
          <p style="color:#3a6080;font-size:12px;margin-top:24px;">
            此链接 1 小时内有效。<br>
            或复制以下链接到浏览器：<br>
            <span style="color:#00d4ff;word-break:break-all;">${resetUrl}</span>
          </p>
          <hr style="border:none;border-top:1px solid #0a3a5c;margin:24px 0;">
          <p style="color:#3a6080;font-size:11px;text-align:center;">
            FanBaaS · 由 <span style="color:#00d4ff;">歪歪</span> 开发 · 公众号：<span style="color:#00d4ff;">小凡平凡</span>
          </p>
        </div>
      </body>
      </html>
    `,
  });

  logger.info('密码重置邮件已发送', { to: toEmail });
  return { sent: true };
}

async function sendWelcome(toEmail, name) {
  if (!transporter) return;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await transporter.sendMail({
    from: `"FanBaaS" <${from}>`,
    to: toEmail,
    subject: '欢迎加入 FanBaaS',
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"></head>
      <body style="font-family:Arial,sans-serif;background:#020b18;color:#e0f0ff;padding:40px 20px;">
        <div style="max-width:480px;margin:0 auto;background:#061d35;border:1px solid #0a3a5c;border-top:3px solid #00d4ff;border-radius:6px;padding:36px;">
          <h1 style="font-family:monospace;font-size:20px;color:#00d4ff;letter-spacing:3px;margin-bottom:8px;">FanBaaS</h1>
          <h2 style="font-size:16px;color:#e0f0ff;margin-bottom:16px;">欢迎，${name}！</h2>
          <p style="color:#7aa8cc;font-size:14px;line-height:1.7;">
            你的账号已创建成功。现在可以登录控制台，开始使用数据库、文件存储、云函数等功能。
          </p>
          <a href="${process.env.APP_URL || 'http://localhost:8080'}/console"
             style="display:inline-block;margin-top:20px;padding:12px 32px;background:linear-gradient(135deg,#0066ff,#00d4ff);color:#fff;text-decoration:none;border-radius:3px;font-weight:bold;font-size:14px;">
            进入控制台
          </a>
          <hr style="border:none;border-top:1px solid #0a3a5c;margin:24px 0;">
          <p style="color:#3a6080;font-size:11px;text-align:center;">
            FanBaaS · 由 <span style="color:#00d4ff;">歪歪</span> 开发 · 公众号：<span style="color:#00d4ff;">小凡平凡</span>
          </p>
        </div>
      </body>
      </html>
    `,
  }).catch(e => logger.warn('欢迎邮件发送失败', { message: e.message }));
}

module.exports = { sendPasswordReset, sendWelcome };
