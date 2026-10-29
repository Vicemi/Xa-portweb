// Lista de niveles que se puede elegir/votar en el lobby online. Son los 16 originales y los 16 extra del mapa 2
// (los extra tienen jefe, así que no se les pueden apagar los power-ups).
import levelData from '../data/levels.json';

const TITLES = (levelData as unknown as { titles: string[] }).titles;

const EXTRA_TITLES = [
  'La Costa', 'El Puerto', 'El Pueblo Solar', 'La Capital Tomada', 'Los Bañados', 'El Bosque Embrujado',
  'La Ciudad de Noche', 'Los Viñedos', 'La Isla de Lucy', 'Los Muelles Viejos', 'Los Suburbios', 'El Castillo de Drácula',
  'La Rambla', 'Las Sierras', 'La Revancha', 'El Hipódromo',
];

export interface OnlineLevel {
  /** número de progreso: 1..16 originales, 101..116 extra */
  num: number;
  title: string;
  boss: boolean;
}

export const ONLINE_LEVELS: OnlineLevel[] = [
  ...Array.from({ length: 16 }, (_, i) => ({ num: i + 1, title: TITLES[i] ?? `Nivel ${i + 1}`, boss: false })),
  ...EXTRA_TITLES.map((title, i) => ({ num: 101 + i, title, boss: true })),
];

export const isBossLevel = (num: number): boolean => num >= 101;
export const levelTitle = (num: number): string => ONLINE_LEVELS.find((l) => l.num === num)?.title ?? `Nivel ${num}`;
