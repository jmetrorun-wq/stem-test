// Couleurs et libellés partagés par les écrans. Fond noir pour se fondre
// avec le logo.

export const C = {
  bg: '#000000', card: '#16181f', text: '#eef0f4', muted: '#9aa3b2',
  accent: '#4FC3F7', ok: '#a3c9a8', err: '#f28b8b', chip: '#262a35',
};

export const TRACK_LABELS = { drums: 'Batterie', bass: 'Basse', other: 'Autres (guitare, piano…)', vocals: 'Voix' };

// Instrument joué par l'utilisateur -> piste coupée par défaut. Guitare et
// piano sont dans la même piste « autres » de htdemucs.
export const INSTRUMENTS = [
  { id: 'guitar', label: 'Guitare / piano', stem: 'other' },
  { id: 'bass', label: 'Basse', stem: 'bass' },
  { id: 'drums', label: 'Batterie', stem: 'drums' },
  { id: 'vocals', label: 'Chant', stem: 'vocals' },
  { id: 'none', label: 'J\'écoute', stem: null },
];
