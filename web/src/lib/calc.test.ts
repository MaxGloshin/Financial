import { describe, expect, it } from 'vitest';
import { evaluateAmountExpression, isExpression } from '@/lib/calc.ts';
import { MoneyError } from '@/lib/money.ts';

describe('amount calculator', () => {
  it('adds, subtracts, multiplies and divides in kopecks', () => {
    expect(evaluateAmountExpression('1200+350')).toBe(155_000);
    expect(evaluateAmountExpression('100*3')).toBe(30_000);
    expect(evaluateAmountExpression('(100+50)/2')).toBe(7_500);
    expect(evaluateAmountExpression('0,1+0,2')).toBe(30);
    expect(evaluateAmountExpression('1000-250,50')).toBe(74_950);
    expect(evaluateAmountExpression('−100 + 50')).toBe(-5_000);
  });

  it('detects expressions versus plain amounts', () => {
    expect(isExpression('1200+350')).toBe(true);
    expect(isExpression('100*3')).toBe(true);
    expect(isExpression('(10+2)/2')).toBe(true);
    expect(isExpression('100-20')).toBe(true);
    expect(isExpression('1200')).toBe(false);
    expect(isExpression('1200,50')).toBe(false);
  });

  it('rejects invalid input without eval', () => {
    expect(() => evaluateAmountExpression('alert(1)')).toThrow(MoneyError);
    expect(() => evaluateAmountExpression('10/0')).toThrow('Деление на ноль');
    expect(() => evaluateAmountExpression('(10+2')).toThrow(MoneyError);
    expect(() => evaluateAmountExpression('10+')).toThrow(MoneyError);
    expect(() => evaluateAmountExpression('')).toThrow(MoneyError);
  });
});
