import { describe, expect, it } from 'vitest';
import { aiJobStatusLabel, canCreatePoll, recordingStatusLabel, sanitizePollOptions } from './collaboration-utils';
import { describeNotificationDispatch, notificationProviderConfigured } from '../../server/notifications.mjs';
import { describeRecordingDispatch, recordingStorageConfigured } from '../../server/recordings.mjs';

describe('collaboration helpers', () => {
  it('requires at least two distinct poll options', () => {
    expect(sanitizePollOptions([' Yes ', 'Yes', 'No'])).toEqual(['Yes', 'No']);
    expect(canCreatePoll(['Yes'], 'Lunch?')).toBe(false);
    expect(canCreatePoll(['Yes', 'No'], 'Lunch?')).toBe(true);
  });

  it('does not describe queued recordings as complete', () => {
    expect(recordingStatusLabel('queued')).toContain('Queued');
    expect(recordingStatusLabel('completed')).toBe('Ready to play');
    expect(aiJobStatusLabel('unconfigured')).toContain('AI provider');
  });
});

describe('notification dispatch honesty', () => {
  it('leaves email jobs pending when no provider is configured', () => {
    const previous = process.env.NOTIFICATION_EMAIL_PROVIDER;
    delete process.env.NOTIFICATION_EMAIL_PROVIDER;
    expect(notificationProviderConfigured('email')).toBe(false);
    expect(describeNotificationDispatch({ status: 'pending', channel: 'email' })).toMatchObject({
      delivered: false,
      status: 'pending',
    });
    if (previous) process.env.NOTIFICATION_EMAIL_PROVIDER = previous;
  });
});

describe('recording dispatch honesty', () => {
  it('does not start egress without storage configuration', () => {
    const previous = process.env.RECORDING_STORAGE_BUCKET;
    delete process.env.RECORDING_STORAGE_BUCKET;
    expect(recordingStorageConfigured()).toBe(false);
    expect(describeRecordingDispatch({ status: 'queued' }).started).toBe(false);
    if (previous) process.env.RECORDING_STORAGE_BUCKET = previous;
  });
});
