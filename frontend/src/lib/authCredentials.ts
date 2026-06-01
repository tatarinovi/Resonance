/** Shared rules for login + registration username/password fields. */

export const MIN_USERNAME_LEN = 3;
export const MIN_PASSWORD_LEN = 6;

const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;
/** Printable ASCII except space — no Cyrillic or other Unicode. */
const PASSWORD_PATTERN = /^[\x21-\x7E]+$/;

export function validateUsername(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "Введите логин";
  if (/\s/.test(raw)) return "Логин не должен содержать пробелы";
  if (trimmed.length < MIN_USERNAME_LEN) return `Логин не короче ${MIN_USERNAME_LEN} символов`;
  if (!USERNAME_PATTERN.test(trimmed)) return "Логин: только латинские буквы, цифры и символ _";
  return null;
}

export function validatePassword(raw: string): string | null {
  if (!raw) return "Введите пароль";
  if (/\s/.test(raw)) return "Пароль не должен содержать пробелы";
  if (raw.length < MIN_PASSWORD_LEN) return `Пароль не короче ${MIN_PASSWORD_LEN} символов`;
  if (!PASSWORD_PATTERN.test(raw)) {
    return "Пароль: латинские буквы, цифры и допустимые знаки (без пробелов и кириллицы)";
  }
  return null;
}
