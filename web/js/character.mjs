// The ImportReady guide: an original "paper sheet" character (a lime document with a folded corner)
// assembled from named groups so limbs and props move independently:
//   .guide > .facing (mirroring) > .bob (idle bob) > body / eyes / .arm-far / .arm-near / legs
// Poses select geometry and a prop; motion lives in CSS keyed by the pose class.
// No <defs> are used, so repeated instances cannot collide on ids.

const BODY = `
  <path class="g-body" d="M74 30H152L180 58V166Q180 180 166 180H74Q60 180 60 166V44Q60 30 74 30Z"/>
  <path class="g-fold" d="M152 30V50Q152 58 160 58H180Z"/>
  <path class="g-lines" d="M82 140H138M82 152H120"/>
  <g class="g-face">
    <g class="g-eyes"><ellipse class="g-eye" cx="98" cy="92" rx="4.6" ry="6.2"/><ellipse class="g-eye" cx="134" cy="92" rx="4.6" ry="6.2"/></g>
    <path class="g-mouth" d="M106 108Q116 116 126 108"/>
    <circle class="g-cheek" cx="89" cy="106" r="6"/><circle class="g-cheek" cx="143" cy="106" r="6"/>
  </g>`;

const LEGS = `
  <path class="g-limb" d="M98 180V203M134 180V203"/>
  <ellipse class="g-foot" cx="94" cy="206" rx="9" ry="4"/><ellipse class="g-foot" cx="138" cy="206" rx="9" ry="4"/>`;

const hand = (x, y) => `<circle class="g-hand" cx="${x}" cy="${y}" r="6.5"/>`;

// Props are drawn in the coordinate space of the arm that holds them.
const PROPS = {
  packet: `<g class="g-prop"><rect class="p-sheet-back" x="16" y="128" width="30" height="38" rx="5" transform="rotate(-8 31 147)"/>
    <rect class="p-sheet" x="22" y="132" width="30" height="38" rx="5"/><path class="p-ink" d="M28 144H46M28 152H40"/></g>`,
  magnifier: `<g class="g-prop"><path class="p-handle" d="M192 106L202 92"/>
    <circle class="p-lens" cx="210" cy="78" r="15"/><path class="p-glint" d="M203 72Q206 67 212 67"/></g>`,
  stamp: `<g class="g-prop"><rect class="p-stamp-grip" x="186" y="114" width="12" height="16" rx="5"/>
    <rect class="p-stamp-base" x="178" y="129" width="28" height="9" rx="3"/></g>`,
  pointer: `<g class="g-prop"><path class="p-handle" d="M18 96L2 86"/></g>`,
};

// Scene furniture that stays still while the character acts on it.
const SET = {
  stamp: `<g class="g-set"><rect class="p-paper" x="168" y="196" width="46" height="14" rx="3"/>
    <path class="p-check" d="M180 203l6 4 12-8"/></g>`,
  shelf: `<g class="g-set"><rect class="p-board" x="-4" y="40" width="40" height="120" rx="8"/>
    <rect class="p-doc" x="4" y="52" width="24" height="26" rx="3"/><rect class="p-doc alt" x="4" y="86" width="24" height="26" rx="3"/>
    <rect class="p-doc" x="4" y="120" width="24" height="26" rx="3"/></g>`,
  shrug: `<g class="g-set"><path class="p-question" d="M108 6Q108 -4 118 -4Q128 -4 128 5Q128 11 120 14V19"/><circle class="p-question-dot" cx="120" cy="25" r="2.4"/></g>`,
};

const POSES = {
  // Home: waves with the near arm, holds a small packet with the far arm.
  wave: {
    far: `<path class="g-limb" d="M62 122Q46 132 44 150"/>${hand(44, 152)}${PROPS.packet}`,
    near: `<path class="g-limb" d="M178 118Q196 104 198 84"/>${hand(198, 82)}`,
  },
  // Ask: sweeps a magnifier across the page.
  search: {
    far: `<path class="g-limb" d="M62 122Q48 134 48 152"/>${hand(48, 154)}`,
    near: `<path class="g-limb" d="M178 122Q190 118 192 106"/>${hand(192, 106)}${PROPS.magnifier}`,
  },
  // Dossier: presses a check stamp onto a sheet.
  stamp: {
    far: `<path class="g-limb" d="M62 122Q48 134 48 152"/>${hand(48, 154)}`,
    near: `<path class="g-limb" d="M178 122Q190 126 192 116"/>${hand(192, 116)}${PROPS.stamp}`,
    set: SET.stamp,
  },
  // Sources: points at a shelf of documents.
  shelf: {
    far: `<path class="g-limb" d="M62 120Q40 112 22 100"/>${hand(20, 99)}${PROPS.pointer}`,
    near: `<path class="g-limb" d="M178 122Q192 134 192 152"/>${hand(192, 154)}`,
    set: SET.shelf,
  },
  // Not found: a shrug under a question mark.
  shrug: {
    far: `<path class="g-limb" d="M62 122Q44 116 36 102"/>${hand(35, 100)}`,
    near: `<path class="g-limb" d="M178 122Q196 116 204 102"/>${hand(205, 100)}`,
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
    <ellipse class="g-shadow" cx="116" cy="212" rx="54" ry="7"/>
    ${p.set || ''}
    <g class="facing${mirror ? ' mirrored' : ''}"><g class="bob">
      <g class="arm-far">${p.far}</g>
      ${LEGS}
      ${BODY}
      <g class="arm-near">${p.near}</g>
    </g></g>
  </svg>`;
}

export const POSE_NAMES = Object.keys(POSES);
