import {
  describeNotificationDispatch,
  dispatchNotificationJob,
  notificationProviderConfigured,
  notificationStatusPayload,
} from '../server/notifications.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(!notificationProviderConfigured('email'), 'email must be unconfigured in default test env');
assert(!notificationProviderConfigured('sms'), 'sms must be unconfigured in default test env');
assert(notificationProviderConfigured('in_app'), 'in_app is always available');

const status = notificationStatusPayload();
assert(status.emailConfigured === false, 'status.emailConfigured');
assert(status.smsConfigured === false, 'status.smsConfigured');

const pendingEmail = {
  id: '00000000-0000-0000-0000-000000000001',
  channel: 'email',
  status: 'processing',
  recipient: 'user@example.com',
  template: 'reminder_15m',
  attempt_count: 0,
};

const description = describeNotificationDispatch(pendingEmail);
assert(description.canDeliver === false, 'email cannot deliver without provider');
assert(description.delivered === false, 'must not claim delivered');

const result = await dispatchNotificationJob(pendingEmail, {});
assert(result.delivered === false, 'dispatch must not mark SENT');
assert(result.skipped === true, 'dispatch should skip when provider missing');

const inApp = await dispatchNotificationJob(
  { ...pendingEmail, channel: 'in_app', status: 'processing' },
  {
    async deliverInApp() {
      return { delivered: true, skipped: false, provider: 'in_app' };
    },
  },
);
assert(inApp.delivered === true, 'in-app can complete via adapter');

process.env.NOTIFICATION_EMAIL_PROVIDER = 'http';
process.env.NOTIFICATION_EMAIL_API_KEY = 'test-key';
process.env.NOTIFICATION_EMAIL_FROM = 'noreply@example.com';
assert(notificationProviderConfigured('email'), 'email configured with temp env');

const failedEmail = await dispatchNotificationJob(
  { ...pendingEmail, status: 'processing' },
  {
    async deliverEmail() {
      return { delivered: false, skipped: false, reason: 'provider 500' };
    },
  },
);
assert(failedEmail.delivered === false && failedEmail.skipped === false, 'hard failures stay retryable');

const successEmail = await dispatchNotificationJob(
  { ...pendingEmail, status: 'processing' },
  {
    async deliverEmail() {
      return { delivered: true, skipped: false, provider: 'http', providerMessageId: 'msg_1' };
    },
  },
);
assert(successEmail.delivered === true && successEmail.providerMessageId === 'msg_1', 'provider success path');

delete process.env.NOTIFICATION_EMAIL_PROVIDER;
delete process.env.NOTIFICATION_EMAIL_API_KEY;
delete process.env.NOTIFICATION_EMAIL_FROM;

const badStatus = await dispatchNotificationJob({ ...pendingEmail, status: 'sent' }, {});
assert(badStatus.skipped === true, 'already-sent jobs are not re-dispatched');

console.log('notification dispatch assertions: PASS');
