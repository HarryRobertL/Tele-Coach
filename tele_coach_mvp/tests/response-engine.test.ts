import { describe, it, expect } from 'vitest';
import { selectCoachingPack } from '../engine/response_engine/selector';

describe('Response Engine Smoke Test', () => {
  it('should return non-empty response, question, and bridge', () => {
    const pack = selectCoachingPack("we use experian already");
    
    expect(pack.response).toBeDefined();
    expect(pack.question).toBeDefined();
    expect(pack.bridge).toBeDefined();
    
    expect(typeof pack.response).toBe('string');
    expect(typeof pack.question).toBe('string');
    expect(typeof pack.bridge).toBe('string');
    
    expect(pack.response.trim().length).toBeGreaterThan(0);
    expect(pack.question.trim().length).toBeGreaterThan(0);
    expect(pack.bridge.trim().length).toBeGreaterThan(0);
  });

  it('should have momentum score between 0 and 100', () => {
    const pack = selectCoachingPack("we use experian already");
    
    expect(pack.momentum_score).toBeGreaterThanOrEqual(0);
    expect(pack.momentum_score).toBeLessThanOrEqual(100);
  });

  it('should have valid momentum level', () => {
    const pack = selectCoachingPack("we use experian already");
    
    expect(['low', 'medium', 'high']).toContain(pack.momentum_level);
  });

  it('should have momentum reasons array', () => {
    const pack = selectCoachingPack("we use experian already");
    
    expect(Array.isArray(pack.momentum_reasons)).toBe(true);
  });

  it('should include competitor mention for experian', () => {
    const pack = selectCoachingPack("we use experian already");
    
    expect(pack.momentum_reasons.some(reason => reason.includes('competitor_named:experian'))).toBe(true);
    expect(pack.momentum_score).toBeGreaterThanOrEqual(30);
  });

  it('should have valid objection detection', () => {
    const pack = selectCoachingPack("we use experian already");
    
    expect(pack.objection_id).toBeDefined();
    expect(typeof pack.objection_id).toBe('string');
    expect(pack.confidence).toBeGreaterThanOrEqual(0);
    expect(pack.confidence).toBeLessThanOrEqual(1);
  });

  it('should have valid severity', () => {
    const pack = selectCoachingPack("we use experian already");
    
    expect(['soft', 'medium', 'hard']).toContain(pack.severity);
  });

  it('scores competitor plus quick-look-now as medium or high', () => {
    const pack = selectCoachingPack("we use Experian but I can have a quick look now");
    expect(pack.momentum_level === 'medium' || pack.momentum_level === 'high').toBe(true);
  });

  it('scores send email and six months as low or lower medium', () => {
    const pack = selectCoachingPack("send me an email and call in six months");
    expect(pack.momentum_score).toBeLessThanOrEqual(45);
  });
});
