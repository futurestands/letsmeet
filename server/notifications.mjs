export function notificationProviderConfigured() {
  return Boolean(process.env.NOTIFICATION_EMAIL_PROVIDER && process.env.NOTIFICATION_EMAIL_FROM);
}

export function describeNotificationDispatch(job) {
  if (!notificationProviderConfigured()) {
    return {
      delivered: false,
      status: job?.status ?? 'pending',
      reason: 'No notification provider is configured. The job remains queued.',
    };
  }
  return {
    delivered: false,
    status: 'pending',
    reason: 'Provider configuration is present, but this runtime does not send messages until a dispatcher is wired.',
  };
}
