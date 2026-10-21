import { randomInt } from 'node:crypto';

const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const lower = 'abcdefghijkmnopqrstuvwxyz';
const digits = '23456789';
const symbols = '!@#$%&*?';
const all = `${upper}${lower}${digits}${symbols}`;

function take(characters: string) {
  return characters[randomInt(0, characters.length)];
}

export function createTemporaryPassword(length = 16) {
  if (length < 12) throw new Error('Temporary passwords must contain at least 12 characters.');
  const characters = [take(upper), take(lower), take(digits), take(symbols)];
  while (characters.length < length) characters.push(take(all));

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join('');
}
