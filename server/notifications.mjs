/**
 * Notification provider interface.
 * Business logic never imports a vendor SDK directly — only this adapter surface.
 */

export function notificationProviderConfigured(channel = 'email') {
  if (channel === 'in_app') return true;
  if (channel === 'sms') {
    return Boolean(
      process.env.NOTIFICATION_SMS_PROVIDER
      && process.env.NOTIFICATION_SMS_API_KEY
      && process.env.NOTIFICATION_SMS_FROM,
    );
  }
  return Boolean(
    process.env.NOTIFICATION_EMAIL_PROVIDER
    && process.env.NOTIFICATION_EMAIL_API_KEY
    && process.env.NOTIFICATION_EMAIL_FROM,
  );
}

export function notificationStatusPayload() {
  return {
    emailConfigured: notificationProviderConfigured('email'),
    smsConfigured: notificationProviderConfigured('sms'),
    inAppEnabled: true,
    note: 'Jobs stay pending until a real provider accepts them. Pending does not mean delivered.',
  };
}

export function describeNotificationDispatch(job) {
  const channel = job?.channel ?? 'email';
  if (channel === 'in_app') {
    return {
      delivered: false,
      canDeliver: Boolean(job?.recipient),
      status: job?.status ?? 'pending',
      reason: 'In-app delivery writes a user notification row when the recipient has an account.',
    };
  }
  if (!notificationProviderConfigured(channel)) {
    return {
      delivered: false,
      canDeliver: false,
      status: job?.status ?? 'pending',
      reason: 'No notification provider is configured. The job remains queued.',
    };
  }
  return {
    delivered: false,
    canDeliver: true,
    status: job?.status ?? 'pending',
    reason: 'Provider credentials are present. The dispatcher may attempt delivery.',
  };
}

async function sendWithTimeout(promiseFactory, timeoutMs = 12_000) {
  let timer;
  try {
    return await Promise.race([
      promiseFactory(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Provider timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Generic HTTP email provider (Resend-compatible JSON by default).
 * Activated only when NOTIFICATION_EMAIL_PROVIDER + API key + from are set.
 */
export async function deliverEmailViaConfiguredProvider(job) {
  const provider = String(process.env.NOTIFICATION_EMAIL_PROVIDER || '').toLowerCase();
  const apiKey = process.env.NOTIFICATION_EMAIL_API_KEY;
  const from = process.env.NOTIFICATION_EMAIL_FROM;
  if (!provider || !apiKey || !from || !job?.recipient) {
    return { delivered: false, skipped: true, reason: 'Email provider is not fully configured.' };
  }

  const subject = `LeTsMeet ${String(job.template || 'notification').replace(/_/g, ' ')}`;
  const text = `This is a LeTsMeet ${String(job.template || 'notification').replace(/_/g, ' ')} for your scheduled meeting.`;

  if (provider === 'resend') {
    const response = await sendWithTimeout(() => fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [job.recipient],
        subject,
        text,
      }),
    }));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        delivered: false,
        skipped: false,
        reason: String(body?.message || body?.error || `Email provider HTTP ${response.status}`).slice(0, 400),
      };
    }
    return {
      delivered: true,
      skipped: false,
      provider: 'resend',
      providerMessageId: body?.id ? String(body.id) : null,
    };
  }

  if (provider === 'http' || provider === 'webhook') {
    const endpoint = process.env.NOTIFICATION_EMAIL_WEBHOOK_URL;
    if (!endpoint) {
      return { delivered: false, skipped: true, reason: 'NOTIFICATION_EMAIL_WEBHOOK_URL is required for http provider.' };
    }
    const response = await sendWithTimeout(() => fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: job.recipient,
        subject,
        text,
        template: job.template,
        meetingId: job.meeting_id,
        idempotencyKey: job.idempotency_key,
      }),
    }));
    if (!response.ok) {
      return { delivered: false, skipped: false, reason: `Email webhook HTTP ${response.status}` };
    }
    const body = await response.json().catch(() => ({}));
    return {
      delivered: true,
      skipped: false,
      provider: 'http',
      providerMessageId: body?.id ? String(body.id) : null,
    };
  }

  return {
    delivered: false,
    skipped: true,
    reason: `Unsupported email provider "${provider}". Supported: resend, http.`,
  };
}

export async function deliverSmsViaConfiguredProvider(job) {
  if (!notificationProviderConfigured('sms') || !job?.recipient) {
    return { delivered: false, skipped: true, reason: 'SMS provider is not configured.' };
  }
  // Intentionally not wired to a vendor until staging credentials exist.
  return {
    delivered: false,
    skipped: true,
    reason: 'SMS provider credentials are present, but no SMS vendor adapter is enabled yet.',
  };
}

export async function dispatchNotificationJob(job, deps) {
  if (!job || (job.status !== 'pending' && job.status !== 'processing')) {
    return { delivered: false, skipped: true, reason: 'Job is not claimable.' };
  }

  if (job.channel === 'in_app') {
    if (!deps?.deliverInApp) {
      return { delivered: false, skipped: true, reason: 'In-app delivery is unavailable.' };
    }
    return deps.deliverInApp(job);
  }

  if (job.channel === 'email') {
    const description = describeNotificationDispatch(job);
    if (!description.canDeliver) {
      return { delivered: false, skipped: true, reason: description.reason };
    }
    if (deps?.deliverEmail) return deps.deliverEmail(job);
    return deliverEmailViaConfiguredProvider(job);
  }

  if (job.channel === 'sms') {
    const description = describeNotificationDispatch(job);
    if (!description.canDeliver) {
      return { delivered: false, skipped: true, reason: description.reason };
    }
    if (deps?.deliverSms) return deps.deliverSms(job);
    return deliverSmsViaConfiguredProvider(job);
  }

  return { delivered: false, skipped: true, reason: `Unsupported channel ${job.channel}` };
}
