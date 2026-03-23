import { describe, it, expect } from 'vitest';
import { loadCreditsafePlaybookSafe } from '../engine/playbooks/playbook_loader';

// Test objection detection logic directly by checking triggers
describe('Objection Classification', () => {
  const playbook = loadCreditsafePlaybookSafe();

  function findObjectionById(id: string) {
    return playbook.objections.find(obj => obj.id === id);
  }

  it('should have already_use_provider objection with experian trigger', () => {
    const objection = findObjectionById('already_use_provider');
    expect(objection).toBeDefined();
    expect(objection!.triggers).toContain('we use experian');
  });

  it('should have send_email objection with correct trigger', () => {
    const objection = findObjectionById('send_email');
    expect(objection).toBeDefined();
    expect(objection!.triggers).toContain('send me an email');
  });

  it('should have not_interested_cartwheel objection with correct trigger', () => {
    const objection = findObjectionById('not_interested_cartwheel');
    expect(objection).toBeDefined();
    expect(objection!.triggers).toContain('not interested at all');
  });

  it('should have manual_process objection with correct trigger', () => {
    const objection = findObjectionById('manual_process');
    expect(objection).toBeDefined();
    expect(objection!.triggers).toContain('we do everything manually');
  });

  it('should have who_are_creditsafe objection with correct trigger', () => {
    const objection = findObjectionById('who_are_creditsafe');
    expect(objection).toBeDefined();
    expect(objection!.triggers).toContain('who are creditsafe');
  });
});
