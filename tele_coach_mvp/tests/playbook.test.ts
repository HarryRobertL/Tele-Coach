import { describe, it, expect } from 'vitest';
import { loadCreditsafePlaybookSafe } from '../engine/playbooks/playbook_loader';

describe('Playbook Loading', () => {
  const playbook = loadCreditsafePlaybookSafe();

  it('should load creditsafe_playbook.json successfully', () => {
    expect(playbook).toBeDefined();
    expect(playbook.objections).toBeDefined();
  });

  it('should have more than 10 objections', () => {
    expect(playbook.objections.length).toBeGreaterThan(10);
  });

  it('should ensure each objection has required fields', () => {
    for (const objection of playbook.objections) {
      expect(objection).toHaveProperty('id');
      expect(objection).toHaveProperty('triggers');
      expect(objection).toHaveProperty('replies');
      expect(objection).toHaveProperty('questions');
      expect(objection).toHaveProperty('severity');
      
      expect(typeof objection.id).toBe('string');
      expect(Array.isArray(objection.triggers)).toBe(true);
      expect(Array.isArray(objection.replies)).toBe(true);
      expect(Array.isArray(objection.questions)).toBe(true);
      expect(objection.triggers.length).toBeGreaterThan(0);
      expect(objection.replies.length).toBeGreaterThan(0);
      expect(objection.questions.length).toBeGreaterThan(0);
    }
  });
});
