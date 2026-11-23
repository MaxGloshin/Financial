export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

const MAX_MINOR = 1_000_000_000_00; // 1 млрд рублей в копейках

/**
 * Parses user input into integer kopecks.
 * Accepts "1 234,56", "1234.56", "250", "250,5", "-100".
 * Rejects more than two decimal places, empty values and non-numeric input.
 */
export function parseMoneyToMinor(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input)) throw new MoneyError('Сумма должна быть целым числом копеек');
    if (Math.abs(input) > MAX_MINOR) throw new MoneyError('Сумма слишком велика');
    return input;
  }

  let value = String(input).trim();
  if (!value) throw new MoneyError('Сумма не указана');

  value = value.replace(/\u00a0|\u202f|\s/g, '').replace(/₽|руб\.?|р\.?/gi, '');
  if (!value) throw new MoneyError('Сумма не указана');

  let sign = 1;
  if (value.startsWith('-')) {
    sign = -1;
    value = value.slice(1);
  } else if (value.startsWith('+')) {
    value = value.slice(1);
  }

  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value)) {
    throw new MoneyError('Сумма должна быть числом с двумя знаками после запятой');
  }

  const normalized = value.replace(',', '.');
  const [whole, fraction = ''] = normalized.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

  if (!Number.isSafeInteger(minor) || minor > MAX_MINOR) {
    throw new MoneyError('Сумма слишком велика');
  }
  return sign * minor;
}

export function assertMinor(value: number): number {
  if (!Number.isSafeInteger(value)) throw new MoneyError('Деньги хранятся только в целых копейках');
  if (Math.abs(value) > MAX_MINOR) throw new MoneyError('Сумма слишком велика');
  return value;
}

export function formatMinor(minor: number): string {
  assertMinor(minor);
  const sign = minor < 0 ? '−' : '';
  const abs = Math.abs(minor);
  const rubles = Math.floor(abs / 100);
  const kopecks = abs % 100;
  const grouped = rubles.toLocaleString('ru-RU').replace(/\u00a0/g, ' ');
  return `${sign}${grouped},${String(kopecks).padStart(2, '0')} ₽`;
}

export function toMinorString(minor: number): string {
  assertMinor(minor);
  return String(minor);
}
