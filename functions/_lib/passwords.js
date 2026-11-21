// Admin passwords. Only a salted PBKDF2-SHA256 hash is stored, never the password itself.
import { HttpError } from "./core.js";

const ITERATIONS = 100000; // the maximum Cloudflare Workers supports
export const MIN_LENGTH = 12;
export const MAX_FAILED = 5;
export const LOCK_MS = 15 * 60 * 1000;

const COMMON = [
  "password", "passwordpassword", "password1234", "password12345", "123456789012", "qwertyuiopas",
  "qwerty123456", "letmein12345", "welcome12345", "iloveyou1234", "adminadmin12", "administrator",
  "alphatechforge", "changeme1234", "aaaaaaaaaaaa", "abc123456789", "111111111111", "000000000000"
];

const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { hash: toB64(await derive(password, salt, ITERATIONS)), salt: toB64(salt), iterations: ITERATIONS };
}

export async function checkPassword(password, stored) {
  const actual = new Uint8Array(await derive(password, fromB64(stored.salt), stored.iterations));
  const expected = fromB64(stored.hash);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

// Spends the same time as a real check, so response times don't reveal which emails have passwords.
export async function dummyCheck(password) {
  await derive(password || "x", new Uint8Array(16), ITERATIONS);
  return false;
}

export function validateNewPassword(password, email) {
  if (typeof password !== "string" || password.length < MIN_LENGTH) {
    throw new HttpError(400, `Use at least ${MIN_LENGTH} characters.`);
  }
  if (password.length > 200) throw new HttpError(400, "That password is too long.");
  const lower = password.toLowerCase();
  const name = email.split("@")[0];
  const containsName = name.length >= 6 && lower.includes(name);
  if (COMMON.includes(lower) || /^(.)\1+$/.test(password) || lower === email || containsName) {
    throw new HttpError(400, "That password is too easy to guess. Try a longer phrase of unrelated words.");
  }
}
