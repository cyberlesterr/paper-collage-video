export type Role = 'primary' | 'secondary' | 'tertiary';

export const roleMotion = {
  primary: {distance: 78, rise: 55, startScale: 0.86},
  secondary: {distance: 58, rise: 38, startScale: 0.9},
  tertiary: {distance: 38, rise: 22, startScale: 0.95},
} satisfies Record<
  Role,
  {distance: number; rise: number; startScale: number}
>;
