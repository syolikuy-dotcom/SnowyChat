// Util khusus Minecraft: kode warna §, kategori & ikon item, tujuan armor.
export interface ColorSpan {
  text: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

const COLORS: Record<string, string> = {
  '0': '#000000', '1': '#0000aa', '2': '#00aa00', '3': '#00aaaa', '4': '#aa0000', '5': '#aa00aa',
  '6': '#ffaa00', '7': '#aaaaaa', '8': '#555555', '9': '#5555ff', a: '#55ff55', b: '#55ffff',
  c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff',
};

export function parseColorCodes(input: string): ColorSpan[] {
  const out: ColorSpan[] = [];
  let state: Omit<ColorSpan, 'text'> = {};
  let buf = '';
  const flush = () => {
    if (buf) out.push({ text: buf, ...state });
    buf = '';
  };
  for (let i = 0; i < input.length; i++) {
    if (input[i] === '§' && i + 1 < input.length) {
      const code = input[++i].toLowerCase();
      flush();
      if (COLORS[code]) state = { color: COLORS[code] };
      else if (code === 'l') state = { ...state, bold: true };
      else if (code === 'o') state = { ...state, italic: true };
      else if (code === 'n') state = { ...state, underline: true };
      else if (code === 'm') state = { ...state, strike: true };
      else if (code === 'r') state = {};
    } else buf += input[i];
  }
  flush();
  return out;
}

export type ItemCat = 'weapon' | 'bow' | 'tool' | 'armor' | 'food' | 'misc';
const FOODS = ['apple', 'bread', 'steak', 'beef', 'pork', 'chicken', 'mutton', 'salmon', 'cod', 'carrot', 'potato', 'melon', 'berry', 'cookie', 'cake', 'stew', 'soup', 'rabbit', 'honey', 'golden'];

export function itemCategory(name = ''): ItemCat {
  const n = name.toLowerCase();
  if (n.includes('sword') || n.includes('mace')) return 'weapon';
  if (n.includes('bow') || n.includes('arrow')) return 'bow';
  if (n.includes('pickaxe') || n.includes('axe') || n.includes('shovel') || n.includes('hoe') || n.includes('shears') || n.includes('flint') || n.includes('fishing')) return 'tool';
  if (['helmet', 'cap', 'chestplate', 'tunic', 'elytra', 'leggings', 'boots', 'shield'].some((k) => n.includes(k))) return 'armor';
  if (FOODS.some((k) => n.includes(k))) return 'food';
  return 'misc';
}

export const CAT_COLOR: Record<ItemCat, string> = {
  weapon: '#f87171', bow: '#fbbf24', tool: '#67e8f9', armor: '#a78bfa', food: '#4ade80', misc: '#8a8f9c',
};

export function armorDest(name: string): 'head' | 'torso' | 'legs' | 'feet' | null {
  const s = name.toLowerCase();
  if (s.includes('helmet') || s.includes('cap')) return 'head';
  if (s.includes('chestplate') || s.includes('tunic') || s.includes('elytra')) return 'torso';
  if (s.includes('leggings')) return 'legs';
  if (s.includes('boots')) return 'feet';
  return null;
}

export const durColor = (p: number) => (p > 60 ? '#4ade80' : p > 30 ? '#fbbf24' : '#f87171');
