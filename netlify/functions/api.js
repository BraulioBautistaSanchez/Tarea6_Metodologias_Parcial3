import express from 'express';
import serverless from 'serverless-http';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const router = express.Router();
app.use(express.json());

const esCorreoValido = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// Evita HTML injection en el cuerpo del correo
const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
           .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- RETO 1: middleware de API Key ----------
function requireApiKey(req, res, next) {
  const key = req.header('x-api-key');
  if (!key || key !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ status: 'error', message: 'No autorizado: x-api-key inválida o ausente.' });
  }
  next();
}

// ---------- Endpoint 1 ----------
router.get('/time', (req, res) => {
  const now = new Date();
  res.status(200).json({
    status: 'success',
    data: {
      serverTimeISO: now.toISOString(),
      timestamp: now.getTime(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      formatted: now.toUTCString(),
      platform: 'Netlify Functions (AWS Lambda)'
    }
  });
});

// ---------- Endpoint 2 ----------
router.post('/send-email', requireApiKey, async (req, res) => {
  try {
    const { to, subject, message, senderName } = req.body || {};

    if (!to || !subject || !message) {
      return res.status(400).json({ status: 'error', message: 'to, subject y message son requeridos.' });
    }
    if (!esCorreoValido(to)) {
      return res.status(400).json({ status: 'error', message: 'El formato del campo "to" no es válido.' });
    }
    // ---------- RETO 2: CRLF injection ----------
    if (/[\r\n]/.test(subject) || /[\r\n]/.test(to)) {
      return res.status(400).json({ status: 'error', message: 'Los campos no pueden contener saltos de línea.' });
    }

    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM } = process.env;
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      return res.status(500).json({ status: 'error', message: 'Servicio de correo no configurado.' });
    }

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });

    // ---------- RETO 3: plantilla HTML ----------
    const nombre = escapeHtml(senderName || 'Sistema');
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
        <div style="background:#2b2d42;color:#fff;padding:16px 24px;">
          <h2 style="margin:0;">${escapeHtml(subject)}</h2>
        </div>
        <div style="padding:24px;color:#333;line-height:1.5;">
          <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
          <p style="margin-top:32px;">Atentamente,<br><strong>${nombre}</strong></p>
        </div>
        <div style="background:#f4f4f4;padding:12px 24px;font-size:12px;color:#888;">
          Enviado mediante Netlify Express API Serverless el ${new Date().toUTCString()}
        </div>
      </div>`;

    const info = await transporter.sendMail({
      from: EMAIL_FROM || `"API Serverless" <${SMTP_USER}>`,
      to, subject, text: message, html
    });

    res.status(200).json({
      status: 'success',
      message: 'Correo despachado satisfactoriamente.',
      data: { messageId: info.messageId, recipient: to }
    });
  } catch (error) {
    console.error('Error al enviar correo:', error.message);
    // No se devuelve error.message para no filtrar datos internos
    res.status(500).json({ status: 'error', message: 'Fallo interno al despachar el correo.' });
  }
});

// Montar en ambos prefijos: según cómo Netlify reescriba la ruta, funciona igual
app.use('/api', router);
app.use('/.netlify/functions/api', router);

export const handler = serverless(app);