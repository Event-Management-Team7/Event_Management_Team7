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

function createSmtpTransport() {
  return {
    async sendMail() {
      throw new Error('SMTP mail transport is not configured');
    }
  };
}

export function createMailer({
  transport = process.env.MAIL_TRANSPORT ?? DEFAULT_TRANSPORT
} = {}) {
  let selectedTransport;

  if (transport === 'memory') {
    selectedTransport = createMemoryTransport();
  } else if (transport === 'smtp') {
    selectedTransport = createSmtpTransport();
  } else {
    throw new Error(`Unsupported MAIL_TRANSPORT: ${transport}`);
  }

  return {
    async sendMail({ to, subject, text }) {
      try {
        return await selectedTransport.sendMail({ to, subject, text });
      } catch (error) {
        console.error('Email delivery failed:', {
          to,
          subject,
          error: error instanceof Error ? error.message : String(error)
        });
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
