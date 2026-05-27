import { describe, it, expect } from 'vitest';
import {
  eventKey,
  actionKey,
  noteKey,
  scoreKey,
  rewardIdempotencyKey,
  metricsKey,
  metricsLatestKey,
  eventDetailKey,
  actionDetailKey,
  noteDetailKey,
  activeUsersKey,
  qualityCheckKey,
} from '../../src/utils/redis-keys.js';

describe('Redis key generation', () => {
  describe('eventKey', () => {
    it('generates a namespaced key for user events', () => {
      expect(eventKey('alice')).toBe('modkudos:events:alice');
    });
  });

  describe('actionKey', () => {
    it('generates a namespaced key for user mod actions', () => {
      expect(actionKey('bob')).toBe('modkudos:actions:bob');
    });
  });

  describe('noteKey', () => {
    it('generates a namespaced key for user mod notes', () => {
      expect(noteKey('carol')).toBe('modkudos:notes:carol');
    });
  });

  describe('scoreKey', () => {
    it('generates a namespaced key for user quality score', () => {
      expect(scoreKey('dave')).toBe('modkudos:score:dave');
    });
  });

  describe('rewardIdempotencyKey', () => {
    it('generates a namespaced key with username, contentId, and rewardType', () => {
      expect(rewardIdempotencyKey('alice', 't3_abc', 'flair')).toBe(
        'modkudos:rewards:alice:t3_abc:flair',
      );
    });

    it('produces distinct keys for different reward types', () => {
      const k1 = rewardIdempotencyKey('alice', 't3_abc', 'flair');
      const k2 = rewardIdempotencyKey('alice', 't3_abc', 'thank_you_message');
      const k3 = rewardIdempotencyKey('alice', 't3_abc', 'recognition_post');
      expect(new Set([k1, k2, k3]).size).toBe(3);
    });
  });

  describe('metricsKey', () => {
    it('generates a namespaced key with a timestamp', () => {
      expect(metricsKey(1700000000000)).toBe('modkudos:metrics:1700000000000');
    });
  });

  describe('metricsLatestKey', () => {
    it('generates the fixed latest metrics key', () => {
      expect(metricsLatestKey()).toBe('modkudos:metrics:latest');
    });
  });

  describe('eventDetailKey', () => {
    it('generates a namespaced key for an event detail', () => {
      expect(eventDetailKey('evt-001')).toBe('modkudos:event:evt-001');
    });
  });

  describe('actionDetailKey', () => {
    it('generates a namespaced key for an action detail', () => {
      expect(actionDetailKey('act-001')).toBe('modkudos:action:act-001');
    });
  });

  describe('noteDetailKey', () => {
    it('generates a namespaced key for a note detail', () => {
      expect(noteDetailKey('note-001')).toBe('modkudos:note:note-001');
    });
  });

  describe('activeUsersKey', () => {
    it('generates the fixed active users key', () => {
      expect(activeUsersKey()).toBe('modkudos:users:active');
    });
  });

  describe('qualityCheckKey', () => {
    it('generates a namespaced key for a quality check flag', () => {
      expect(qualityCheckKey('t3_xyz')).toBe('modkudos:quality:check:t3_xyz');
    });
  });

  describe('namespace separation', () => {
    it('all key generators produce keys with distinct namespace prefixes for the same identifier', () => {
      const username = 'testuser';
      const keys = [
        eventKey(username),
        actionKey(username),
        noteKey(username),
        scoreKey(username),
        eventDetailKey(username),
        actionDetailKey(username),
        noteDetailKey(username),
      ];
      // All keys should be unique
      expect(new Set(keys).size).toBe(keys.length);

      // Each key should start with 'modkudos:' and have a different second segment
      const namespaces = keys.map((k) => k.split(':').slice(0, -1).join(':'));
      expect(new Set(namespaces).size).toBe(namespaces.length);
    });
  });
});
