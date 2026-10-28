import nodemailer from 'nodemailer';

const DEFAULT_TRANSPORT = 'memory';

function createMemoryTransport() {
  const sentMessages = [];

  return {
    async sendMail({ to, subject, text }) {
      const message = { to, subject, text };
      sentMessages.push(message);
      return message;
    },
    getSentMessages() {
      return [...sentMessages];
    },
    clear() {
      sentMessages.length = 0;
    }
  };
}

function requiredSetting(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} is required when MAIL_TRANSPORT=smtp`);
  }
  return value;
}

function createSmtpTransport({ env, smtpTransportFactory }) {
  const host = requiredSetting(env, 'SMTP_HOST');
  const portValue = requiredSetting(env, 'SMTP_PORT');
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT must be an integer between 1 and 65535');
  }
  const user = requiredSetting(env, 'SMTP_USER');
  const pass = requiredSetting(env, 'SMTP_PASS');
  const from = requiredSetting(env, 'MAIL_FROM');
  const transport = smtpTransportFactory({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });

  return {
    async sendMail({ to, subject, text }) {
      return transport.sendMail({ from, to, subject, text });
    }
  };
}

export function createMailer({
  transport = process.env.MAIL_TRANSPORT ?? DEFAULT_TRANSPORT,
  env = process.env,
  smtpTransportFactory = nodemailer.createTransport
} = {}) {
  let selectedTransport;

  if (transport === 'memory') {
    selectedTransport = createMemoryTransport();
  } else if (transport === 'smtp') {
    selectedTransport = createSmtpTransport({ env, smtpTransportFactory });
  } else {
    throw new Error(`Unsupported MAIL_TRANSPORT: ${transport}`);
  }

  return {
    async sendMail({ to, subject, text }) {
      try {
        return await selectedTransport.sendMail({ to, subject, text });
      } catch {
        console.error('Email delivery failed');
        return null;
      }
    },

    getSentMessages() {
      return selectedTransport.getSentMessages?.() ?? [];
    },

    clear() {
      selectedTransport.clear?.();
    }
  };
}

export async function sendMailSafely(mailer, message) {
  try {
    await mailer.sendMail(message);
  } catch {
    console.error('Email delivery failed');
  }
}
