import { describe, expect, it } from 'vitest';
import {
  MAX_MINOR,
  MoneyError,
  formatBalance,
  formatMoney,
  formatMoneyInput,
  parseMoneyToMinor,
} from '@/lib/money.ts';

describe('parseMoneyToMinor', () => {
  it('parses common Russian formats into integer kopecks', () => {
    expect(parseMoneyToMinor('1 234,56')).toBe(123_456);
    expect(parseMoneyToMinor('1234.56')).toBe(123_456);
    expect(parseMoneyToMinor('1\u00a0234 ₽')).toBe(123_400);
    expect(parseMoneyToMinor('250')).toBe(25_000);
    expect(parseMoneyToMinor('250,5')).toBe(25_050);
    expect(parseMoneyToMinor('0,05')).toBe(5);
    expect(parseMoneyToMinor('−100')).toBe(-10_000);
    expect(parseMoneyToMinor(12_345)).toBe(12_345);
  });

  it('rejects malformed or oversized amounts instead of rounding silently', () => {
    expect(() => parseMoneyToMinor('')).toThrow(MoneyError);
    expect(() => parseMoneyToMinor('12,345')).toThrow(MoneyError);
    expect(() => parseMoneyToMinor('1e5')).toThrow(MoneyError);
    expect(() => parseMoneyToMinor('12.3.4')).toThrow(MoneyError);
    expect(() => parseMoneyToMinor(MAX_MINOR + 1)).toThrow(MoneyError);
  });
});

describe('formatMoney', () => {
  it('formats kopecks with a non-breaking-free Russian grouping', () => {
    expect(formatMoney(123_456)).toBe('1 234,56 ₽');
    expect(formatMoney(100_000)).toBe('1 000 ₽');
    expect(formatMoney(0)).toBe('0 ₽');
    expect(formatMoney(-123_456)).toBe('−1 234,56 ₽');
    expect(formatMoney(123_456, { plus: true })).toBe('+1 234,56 ₽');
    expect(formatMoney(123_400, { alwaysKopecks: true })).toBe('1 234,00 ₽');
    expect(formatMoney(123_456, { noCurrency: true })).toBe('1 234,56');
    expect(formatBalance(0)).toBe('0 ₽');
    expect(formatBalance(1_000)).toBe('+10 ₽');
  });

  it('round-trips editable values', () => {
    for (const minor of [0, 1, 50, 25_050, 123_456, -100]) {
      expect(parseMoneyToMinor(formatMoneyInput(minor))).toBe(minor);
    }
  });
});
