export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** 1 billion rubles in kopecks. */
export const MAX_MINOR = 1_000_000_000_00;

export function assertMinor(value: number): number {
  if (!Number.isSafeInteger(value)) throw new MoneyError('Деньги хранятся только в целых копейках');
  if (Math.abs(value) > MAX_MINOR) throw new MoneyError('Сумма слишком велика');
  return value;
}

/**
 * Parses user input into integer kopecks.
 * Accepts "1 234,56", "1234.56", "250", "250,5", "-100", "1 200 ₽".
 */
export function parseMoneyToMinor(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input)) throw new MoneyError('Сумма должна быть целым числом копеек');
    if (Math.abs(input) > MAX_MINOR) throw new MoneyError('Сумма слишком велика');
    return input;
  }

  let value = String(input).trim();
  if (!value) throw new MoneyError('Сумма не указана');

  value = value
    .replace(/\u00a0|\u202f|\s/g, '')
    .replace(/₽|руб\.?|р\.?/gi, '');
  if (!value) throw new MoneyError('Сумма не указана');

  let sign = 1;
  if (value.startsWith('-') || value.startsWith('−')) {
    sign = -1;
    value = value.slice(1);
  } else if (value.startsWith('+')) {
    value = value.slice(1);
  }

  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value)) {
    throw new MoneyError('Введите сумму с двумя знаками после запятой');
  }

  const normalized = value.replace(',', '.');
  const [whole, fraction = ''] = normalized.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

  if (!Number.isSafeInteger(minor) || minor > MAX_MINOR) {
    throw new MoneyError('Сумма слишком велика');
  }
  return sign * minor;
}

export type FormatMoneyOptions = {
  /** Show "+" for positive values. */
  plus?: boolean;
  /** Always show kopecks, even when they are zero. */
  alwaysKopecks?: boolean;
  /** Hide the ₽ suffix. */
  noCurrency?: boolean;
};

export function formatMoney(minor: number, options: FormatMoneyOptions = {}): string {
  assertMinor(minor);
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const rubles = Math.floor(abs / 100);
  const kopecks = abs % 100;
  const grouped = rubles.toLocaleString('ru-RU').replace(/\u00a0/g, ' ');
  const showKopecks = options.alwaysKopecks === true || kopecks !== 0;
  const number = showKopecks ? `${grouped},${String(kopecks).padStart(2, '0')}` : grouped;
  const sign = negative ? '−' : options.plus ? '+' : '';
  return `${sign}${number}${options.noCurrency ? '' : ' ₽'}`;
}

/** Signed money for account balances: zero is rendered without a sign. */
export function formatBalance(minor: number): string {
  if (minor === 0) return formatMoney(0);
  return formatMoney(minor, { plus: minor > 0 });
}

export function formatMoneyInput(minor: number): string {
  assertMinor(minor);
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const rubles = Math.floor(abs / 100);
  const kopecks = abs % 100;
  return `${negative ? '-' : ''}${rubles}${kopecks ? `,${String(kopecks).padStart(2, '0')}` : ''}`;
}

export function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (part / total) * 100));
}
