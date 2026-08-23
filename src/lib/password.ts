import bcrypt from "bcrypt";

const ROUNDS = 10;

export function isBcryptHash(value: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(value);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(
  plain: string,
  stored: string
): Promise<boolean> {
  if (isBcryptHash(stored)) {
    return bcrypt.compare(plain, stored);
  }
  return plain === stored;
}

export function needsPasswordHash(stored: string): boolean {
  return stored.length > 0 && !isBcryptHash(stored);
}
