// The MUTABIQ guide: the logo tile come to life. A navy rounded square carries the mark's gold dot,
// two white bars for eyes and the teal bent bar as its smile. Named groups let limbs and props move
// independently of the bobbing body:
//   .guide > .facing (mirroring) > .bob (idle bob) > .arm-far / legs / body / .arm-near
// Poses pick geometry and a prop; motion lives in CSS keyed by the pose class.
// No <defs> are used, so repeated instances cannot collide on ids.

const BODY = `
  <rect class="g-body" x="60" y="36" width="120" height="136" rx="30"/>
  <circle class="g-dot" cx="84" cy="60" r="6.5"/>
  <g class="g-face">
    <g class="g-eyes"><rect class="g-eye" x="96" y="80" width="9" height="17" rx="4.5"/><rect class="g-eye" x="135" y="80" width="9" height="17" rx="4.5"/></g>
    <path class="g-mouth" d="M94 114Q94 126 106 126H146"/>
  </g>`;

const LEGS = `
  <path class="g-limb" d="M100 172V199M140 172V199"/>
  <ellipse class="g-foot" cx="96" cy="203" rx="9.5" ry="4.2"/><ellipse class="g-foot" cx="144" cy="203" rx="9.5" ry="4.2"/>`;

const hand = (x, y) => `<circle class="g-hand" cx="${x}" cy="${y}" r="6.5"/>`;

// Props are drawn in the coordinate space of the arm that holds them.
const PROPS = {
  form: `<g class="g-prop"><rect class="p-card" x="16" y="128" width="32" height="40" rx="5"/>
    <path class="p-bar-teal" d="M23 140H41"/><path class="p-bar-grey" d="M23 149H37M23 158H39"/></g>`,
  magnifier: `<g class="g-prop"><path class="p-handle" d="M192 106L202 92"/>
    <circle class="p-lens" cx="210" cy="78" r="15"/><path class="p-glint" d="M203 72Q206 67 212 67"/></g>`,
  stamp: `<g class="g-prop"><rect class="p-stamp-grip" x="186" y="112" width="12" height="17" rx="5"/>
    <rect class="p-stamp-base" x="178" y="128" width="28" height="9" rx="3"/></g>`,
  pointer: `<g class="g-prop"><path class="p-handle" d="M18 96L2 86"/></g>`,
};

// Scene furniture that stays still while the guide acts on it.
const SET = {
  stamp: `<g class="g-set"><rect class="p-card" x="166" y="190" width="50" height="18" rx="4"/>
    <path class="p-check" d="M179 199l6 4 12-8"/></g>`,
  shelf: `<g class="g-set"><rect class="p-board" x="-6" y="38" width="44" height="124" rx="9"/>
    <rect class="p-card" x="2" y="48" width="28" height="28" rx="4"/><path class="p-bar-teal" d="M8 58H24"/><path class="p-bar-grey" d="M8 66H20"/>
    <rect class="p-card" x="2" y="84" width="28" height="28" rx="4"/><path class="p-bar-gold" d="M8 94H24"/><path class="p-bar-grey" d="M8 102H20"/>
    <rect class="p-card" x="2" y="120" width="28" height="28" rx="4"/><path class="p-bar-teal" d="M8 130H24"/><path class="p-bar-grey" d="M8 138H20"/></g>`,
  shrug: `<g class="g-set"><path class="p-question" d="M110 2Q110 -8 120 -8Q130 -8 130 1Q130 7 122 10V15"/><circle class="p-question-dot" cx="122" cy="22" r="2.6"/></g>`,
};

const POSES = {
  // Overview: waves while holding a small form.
  wave: {
    far: `<path class="g-limb" d="M62 122Q46 132 44 150"/>${hand(44, 152)}${PROPS.form}`,
    near: `<path class="g-limb" d="M178 116Q196 102 198 82"/>${hand(198, 80)}`,
  },
  // Evidence search: sweeps a magnifier.
  search: {
    far: `<path class="g-limb" d="M62 122Q48 134 48 152"/>${hand(48, 154)}`,
    near: `<path class="g-limb" d="M178 120Q190 118 192 106"/>${hand(192, 106)}${PROPS.magnifier}`,
  },
  // Assessment: stamps a check onto a findings sheet.
  stamp: {
    far: `<path class="g-limb" d="M62 122Q48 134 48 152"/>${hand(48, 154)}`,
    near: `<path class="g-limb" d="M178 120Q190 124 192 114"/>${hand(192, 114)}${PROPS.stamp}`,
    set: SET.stamp,
  },
  // Knowledge base: points at a board of indexed documents.
  shelf: {
    far: `<path class="g-limb" d="M62 118Q40 110 22 100"/>${hand(20, 99)}${PROPS.pointer}`,
    near: `<path class="g-limb" d="M178 122Q192 134 192 152"/>${hand(192, 154)}`,
    set: SET.shelf,
  },
  // Not found: a shrug under a question mark.
  shrug: {
    far: `<path class="g-limb" d="M62 120Q44 114 36 100"/>${hand(35, 98)}`,
    near: `<path class="g-limb" d="M178 120Q196 114 204 100"/>${hand(205, 98)}`,
    set: SET.shrug,
  },
};

/**
 * Return SVG markup for the guide.
 * @param {object} o
 * @param {string} [o.pose] wave | search | stamp | shelf | shrug
 * @param {boolean} [o.mirror] face left instead of right
 * @param {string} [o.label] accessible name; omit for decorative use (aria-hidden)
 * @param {string} [o.className]
 */
export function guide({ pose = 'wave', mirror = false, label = '', className = '' } = {}) {
  const p = POSES[pose] || POSES.wave;
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true" focusable="false"';
  return `<svg class="guide pose-${pose} ${className}" viewBox="-10 -14 240 236" ${a11y}>
    <ellipse class="g-shadow" cx="120" cy="210" rx="54" ry="7"/>
    ${p.set || ''}
    <g class="facing${mirror ? ' mirrored' : ''}"><g class="bob">
      <g class="arm-far">${p.far}</g>
      ${LEGS}
      ${BODY}
      <g class="arm-near">${p.near}</g>
    </g></g>
  </svg>`;
}

/** The MUTABIQ mark (logo tile without a face), for the header and footer. */
export function mark(className = 'brand-mark') {
  return `<svg class="${className}" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
    <rect class="mark-tile" width="40" height="40" rx="10"/>
    <circle class="mark-dot" cx="12" cy="14" r="3"/><rect class="mark-bar" x="18" y="11.5" width="13" height="5" rx="2.5"/>
    <path class="mark-check" d="M10 21.5Q10 27.5 16 27.5H30" /></svg>`;
}

export const POSE_NAMES = Object.keys(POSES);
