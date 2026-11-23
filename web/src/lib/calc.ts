import { MoneyError, MAX_MINOR } from './money.ts';

/**
 * A deliberately small arithmetic parser for the amount field.
 * Supports + - * /, parentheses and decimal numbers. No eval().
 * Returns integer kopecks.
 */
export function evaluateAmountExpression(input: string): number {
  const source = input.trim();
  if (!source) throw new MoneyError('Сумма не указана');
  if (!/^[\d\s.,()+\-*/−×÷]+$/.test(source)) {
    throw new MoneyError('В сумме допустимы только цифры и + − × ÷ ( )');
  }

  let index = 0;
  const text = source.replace(/−/g, '-').replace(/×/g, '*').replace(/÷/g, '/');

  function skipSpace() {
    while (index < text.length && /\s/.test(text[index]!)) index++;
  }

  function parseNumber(): number {
    skipSpace();
    const start = index;
    while (index < text.length && /[\d.,]/.test(text[index]!)) index++;
    if (start === index) throw new MoneyError('Проверьте выражение');
    const raw = text.slice(start, index).replace(',', '.');
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new MoneyError('Проверьте сумму');
    const [whole, fraction = ''] = raw.split('.');
    const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(minor) || minor > MAX_MINOR) throw new MoneyError('Сумма слишком велика');
    return minor;
  }

  function parseFactor(): number {
    skipSpace();
    if (text[index] === '(') {
      index++;
      const value = parseExpr();
      skipSpace();
      if (text[index] !== ')') throw new MoneyError('Не закрыта скобка');
      index++;
      return value;
    }
    if (text[index] === '+') {
      index++;
      return parseFactor();
    }
    if (text[index] === '-') {
      index++;
      return -parseFactor();
    }
    return parseNumber();
  }

  function parseTerm(): number {
    let value = parseFactor();
    for (;;) {
      skipSpace();
      const operator = text[index];
      if (operator !== '*' && operator !== '/') return value;
      index++;
      const right = parseFactor();
      if (operator === '*') {
        value = Math.round((value * right) / 100);
      } else {
        if (right === 0) throw new MoneyError('Деление на ноль');
        value = Math.round((value / right) * 100);
      }
      if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_MINOR) {
        throw new MoneyError('Сумма слишком велика');
      }
    }
  }

  function parseExpr(): number {
    let value = parseTerm();
    for (;;) {
      skipSpace();
      const operator = text[index];
      if (operator !== '+' && operator !== '-') return value;
      index++;
      const right = parseTerm();
      value = operator === '+' ? value + right : value - right;
      if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_MINOR) {
        throw new MoneyError('Сумма слишком велика');
      }
    }
  }

  const result = parseExpr();
  skipSpace();
  if (index !== text.length) throw new MoneyError('Проверьте выражение');
  return result;
}

export function isExpression(input: string): boolean {
  return /[+*/()]/.test(input) || /-/.test(input.trim().slice(1));
}
