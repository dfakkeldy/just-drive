// Shared browser/Worker policy. Never send a player's free text as chat.
export const BLOCKLIST = ['fuck', 'shit', 'bitch', 'cunt', 'asshole', 'bastard', 'nigger', 'nigga', 'faggot', 'penis', 'pussy'];
const LEET: Record<string, string> = { '0':'o', '1':'i', '2':'z', '3':'e', '4':'a', '5':'s', '6':'g', '7':'t', '8':'b', '9':'g' };
export function readHandle(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9 -]{3,14}$/.test(value) || !/[A-Za-z0-9]/.test(value)) return null;
  const folded = value.toLowerCase().replace(/[0-9]/g, c => LEET[c]).replace(/[ -]/g, '');
  return BLOCKLIST.some(word => folded.includes(word)) ? null : value;
}
const FIRST = ['Muddy', 'Dusty', 'Sleepy', 'Foggy', 'Wobbly', 'Bouncy'];
const LAST = ['Tire', 'Gravel', 'Culvert', 'Window', 'Pothole', 'Mirror'];
export function inventedName(random = Math.random): string {
  return `${FIRST[Math.floor(random()*FIRST.length)]} ${LAST[Math.floor(random()*LAST.length)]}`;
}
// The last three are for room games: a game sends them only to a room that said hello.games (an older room would count
// them as a strike), and an older game ignores them.
export const PHRASES = ['Race you!', 'Nice!', 'Wait up', 'Follow me', 'Look at this', 'Wrong way', 'Thanks', 'Bye',
  'Who has the parcel?', 'Return to sender', 'Signed for'] as const;
export type PhraseId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export const GAME_PHRASES = 8;
export const isPhraseId = (value: unknown): value is PhraseId => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < PHRASES.length;
export function readChat(text: string): PhraseId | null {
  if (text.length > 64) return null;
  try {
    const m = JSON.parse(text);
    return m?.t === 'chat' && Object.keys(m).length === 2 && isPhraseId(m.phrase) ? m.phrase : null;
  } catch { return null; }
}
export const CHAT_MS = 4000, CHAT_COOLDOWN = 2000;
