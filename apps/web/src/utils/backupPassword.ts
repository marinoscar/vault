/**
 * Pure helpers for the "Back up my data" password field.
 *
 * Product rules: any password of at least {@link BACKUP_PASSWORD_MIN_LENGTH}
 * characters is accepted (no complexity rules); a soft, non-blocking warning
 * is shown when it is shorter than {@link BACKUP_PASSWORD_RECOMMENDED_LENGTH}
 * characters or is a single word.
 */

export const BACKUP_PASSWORD_MIN_LENGTH = 6;
export const BACKUP_PASSWORD_MAX_LENGTH = 256;
export const BACKUP_PASSWORD_RECOMMENDED_LENGTH = 12;

export const BACKUP_PASSWORD_WARNING =
  'Short passwords are easy to guess if this file is lost or shared. Two or three words like "blue tiger river" are much safer and still easy to remember.';

/** Short, common, easy-to-spell words for suggested passphrases. */
export const BACKUP_WORD_LIST: readonly string[] = [
  'apple', 'arrow', 'autumn', 'basket', 'beach', 'berry', 'blue', 'bread',
  'breeze', 'bridge', 'candle', 'canyon', 'castle', 'cedar', 'cherry', 'cloud',
  'clover', 'coast', 'comet', 'copper', 'coral', 'cotton', 'crystal', 'daisy',
  'desert', 'dolphin', 'dragon', 'eagle', 'ember', 'falcon', 'feather', 'field',
  'forest', 'fox', 'garden', 'ginger', 'glacier', 'golden', 'granite', 'green',
  'harbor', 'hazel', 'honey', 'island', 'ivory', 'jade', 'jungle', 'kettle',
  'lagoon', 'lantern', 'lemon', 'lily', 'lion', 'maple', 'marble', 'meadow',
  'melon', 'mint', 'moon', 'mountain', 'nectar', 'ocean', 'olive', 'orange',
  'orchid', 'otter', 'owl', 'panda', 'pebble', 'pepper', 'piano', 'pine',
  'planet', 'plum', 'pond', 'puzzle', 'rabbit', 'rain', 'raven', 'red',
  'river', 'robin', 'rocket', 'rose', 'saddle', 'salmon', 'sand', 'silver',
  'snow', 'spark', 'spring', 'star', 'stone', 'storm', 'summer', 'sun',
  'tiger', 'timber', 'tulip', 'valley', 'velvet', 'violet', 'walnut', 'willow',
  'winter', 'wolf', 'yellow', 'zebra',
];

/** Source of 32-bit random values; defaults to WebCrypto. Injectable for tests. */
export type RandomValues = (array: Uint32Array) => Uint32Array;

const defaultRandom: RandomValues = (array) => crypto.getRandomValues(array);

/** Unbiased random index in [0, max) using rejection sampling. */
function randomIndex(max: number, random: RandomValues): number {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    random(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

/**
 * Suggest an easy-to-remember passphrase: `count` random words from
 * `words`, joined by spaces (default: 3 words, e.g. "blue tiger river").
 */
export function suggestBackupPassword(
  options: { count?: number; words?: readonly string[]; random?: RandomValues } = {},
): string {
  const { count = 3, words = BACKUP_WORD_LIST, random = defaultRandom } = options;
  if (words.length === 0) throw new Error('Word list must not be empty');
  const picked: string[] = [];
  for (let i = 0; i < count; i++) {
    picked.push(words[randomIndex(words.length, random)]);
  }
  return picked.join(' ');
}

/** True when the password is a single word (no whitespace between non-space runs). */
export function isSingleWord(password: string): boolean {
  return password.trim().split(/\s+/).filter(Boolean).length <= 1;
}

/** Whether to show the soft (non-blocking) weak-password warning. */
export function shouldWarnBackupPassword(password: string): boolean {
  if (password.length === 0) return false;
  return password.length < BACKUP_PASSWORD_RECOMMENDED_LENGTH || isSingleWord(password);
}

/**
 * Blocking validation for the password + confirmation pair. Returns an error
 * message for the first failing rule, or null when the pair is acceptable.
 */
export function validateBackupPassword(password: string, confirm: string): string | null {
  if (password.length < BACKUP_PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${BACKUP_PASSWORD_MIN_LENGTH} characters`;
  }
  if (password.length > BACKUP_PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${BACKUP_PASSWORD_MAX_LENGTH} characters`;
  }
  if (password !== confirm) {
    return 'Passwords do not match';
  }
  return null;
}
