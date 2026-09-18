export function notificationProviderConfigured(channel = 'email') {
  if (channel === 'in_app') return true;
  if (channel === 'sms') {
    return Boolean(process.env.NOTIFICATION_SMS_PROVIDER && process.env.NOTIFICATION_SMS_FROM);
  }
  return Boolean(process.env.NOTIFICATION_EMAIL_PROVIDER && process.env.NOTIFICATION_EMAIL_FROM);
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
    canDeliver: false,
    status: 'pending',
    reason: 'Provider configuration is present, but this runtime does not send messages until a dispatcher is wired to that provider.',
  };
}

export async function dispatchNotificationJob(job, deps) {
  if (!job || job.status !== 'pending') {
    return { delivered: false, skipped: true, reason: 'Job is not pending.' };
  }

  if (job.channel === 'in_app') {
    if (!deps?.deliverInApp) {
      return { delivered: false, skipped: true, reason: 'In-app delivery is unavailable.' };
    }
    const delivered = await deps.deliverInApp(job);
    return delivered;
  }

  const description = describeNotificationDispatch(job);
  if (!description.canDeliver) {
    return { delivered: false, skipped: true, reason: description.reason };
  }

  return { delivered: false, skipped: true, reason: description.reason };
}
