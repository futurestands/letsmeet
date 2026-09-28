import { describe, expect, it } from 'vitest';
import { classifyStorageError, isIllegalTransitionError } from '../../server/recordings.mjs';

describe('classifyStorageError (unit: pure helper, not a storage integration test)', () => {
  it('treats 404 / NotFound / NoSuchKey as a definitive miss', () => {
    expect(classifyStorageError({ $metadata: { httpStatusCode: 404 } })).toBe('missing');
    expect(classifyStorageError({ name: 'NotFound' })).toBe('missing');
    expect(classifyStorageError({ name: 'NoSuchKey' })).toBe('missing');
  });

  it('treats everything else as indeterminate so a storage hiccup never marks a recording failed', () => {
    expect(classifyStorageError({ $metadata: { httpStatusCode: 403 } })).toBe('indeterminate');
    expect(classifyStorageError({ $metadata: { httpStatusCode: 503 } })).toBe('indeterminate');
    expect(classifyStorageError(new Error('socket hang up'))).toBe('indeterminate');
    expect(classifyStorageError(undefined)).toBe('indeterminate');
  });
});

describe('isIllegalTransitionError (unit: pure helper)', () => {
  it('recognises state-machine trigger rejections only', () => {
    expect(isIllegalTransitionError({ message: 'Illegal recording status transition from failed to completed' })).toBe(true);
    expect(isIllegalTransitionError({ message: 'connection terminated' })).toBe(false);
    expect(isIllegalTransitionError(null)).toBe(false);
  });
});
