/**
 * Terminal input only ever carries the character the current OS keyboard
 * layout produced for a key — there's no physical-key/scancode info to fall
 * back on. Under a Cyrillic (ЙЦУКЕН) layout, the physical key that sends "s"
 * in a Latin layout sends "ы" instead, so our Latin-letter hotkeys silently
 * stop matching. Map each Cyrillic character back to the Latin letter at the
 * same physical key position, for exactly the keys this app binds.
 */
const CYRILLIC_TO_LATIN: Record<string, string> = {
  й: "q",
  ы: "s",
  с: "c",
  т: "n",
  к: "r",
  о: "j",
  л: "k",
  в: "d",
  н: "y",
};

export function normalizeKey(input: string): string {
  return CYRILLIC_TO_LATIN[input] ?? input;
}
