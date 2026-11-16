import * as THREE from 'three/webgpu';
import { PALETTE } from '../rendering/Palette.ts';
import { rbox, rcyl, smoothSphere, transformGeo } from '../geometry/Sculptor.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { PerchSystem } from './PerchSystem.ts';
import { registerBuildingInterior } from './AtelierBounds.ts';

export type InteriorTheme =
  | 'bookshop'
  | 'roastery'
  | 'gallery'
  | 'patisserie'
  | 'bistro'
  | 'conservatory'
  | 'salon';

export interface TownhouseInteriorOptions {
  id: string;
  cx: number;
  cz: number;
  innerXMin: number;
  innerXMax: number;
  innerZMin: number;
  innerZMax: number;
  baseY: number;
  groundH: number;
  upperFloorH: number;
  floors: number;
  frontFace: 'east' | 'west' | 'north' | 'south';
  wallHex: number;
  shutterHex: number;
  isPerimeter: boolean;
  parts: THREE.BufferGeometry[];
  glowParts: THREE.BufferGeometry[];
  physics: PhysicsWorld;
  perches: PerchSystem;
  avoidRect?: { xMin: number; xMax: number; zMin: number; zMax: number };
}

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickTheme(id: string): InteriorTheme {
  if (id.includes('bookshop')) return 'bookshop';
  if (id.includes('roastery')) return 'roastery';
  if (id.includes('painter')) return 'gallery';
  if (id.includes('coral') || id.includes('gelat') || id.includes('boulangerie')) return 'patisserie';
  if (id.includes('orangerie') || id.includes('mint')) return 'conservatory';
  const themes: InteriorTheme[] = ['bistro', 'salon', 'bookshop', 'gallery', 'conservatory', 'patisserie'];
  return themes[hashString(id) % themes.length];
}

function rectsOverlap(
  ax0: number,
  ax1: number,
  az0: number,
  az1: number,
  b?: { xMin: number; xMax: number; zMin: number; zMax: number }
): boolean {
  if (!b) return false;
  return ax0 < b.xMax && ax1 > b.xMin && az0 < b.zMax && az1 > b.zMin;
}

function addPendantChandelier(
  parts: THREE.BufferGeometry[],
  glowParts: THREE.BufferGeometry[],
  perches: PerchSystem,
  id: string,
  x: number,
  ceilingY: number,
  z: number,
  dropLen = 3.2
): void {
  const lampY = ceilingY - dropLen;
  parts.push(
    transformGeo(rcyl(0.08, 0.08, dropLen, PALETTE.brassWarm, 8), {
      pos: [x, ceilingY - dropLen * 0.5, z],
    }),
    transformGeo(rcyl(1.15, 1.35, 0.24, PALETTE.brassWarm, 12), {
      pos: [x, lampY, z],
    })
  );
  glowParts.push(
    transformGeo(smoothSphere(0.55, PALETTE.goldGlow, 10, 8), {
      pos: [x, lampY - 0.35, z],
    })
  );
  for (const ang of [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5]) {
    glowParts.push(
      transformGeo(smoothSphere(0.28, PALETTE.goldGlow, 8, 6), {
        pos: [x + Math.cos(ang) * 1.15, lampY + 0.24, z + Math.sin(ang) * 1.15],
      })
    );
  }
  perches.addStaticSegment(
    id,
    new THREE.Vector3(x - 1.1, lampY + 0.15, z),
    new THREE.Vector3(x + 1.1, lampY + 0.15, z),
    0.08,
    'metal'
  );
}

function addRug(
  parts: THREE.BufferGeometry[],
  x: number,
  floorY: number,
  z: number,
  w: number,
  d: number,
  outerHex: number,
  innerHex: number
): void {
  parts.push(
    transformGeo(rbox(w, 0.08, d, 0.02, outerHex, 1), { pos: [x, floorY + 0.04, z] }),
    transformGeo(rbox(w * 0.72, 0.09, d * 0.72, 0.02, innerHex, 1), { pos: [x, floorY + 0.05, z] })
  );
}

function addWoodTableAndChairs(
  parts: THREE.BufferGeometry[],
  physics: PhysicsWorld,
  perches: PerchSystem,
  id: string,
  x: number,
  floorY: number,
  z: number,
  topHex: number,
  chairHex: number,
  addCollider = true
): void {
  const topY = floorY + 2.85;
  parts.push(
    transformGeo(rbox(4.6, 0.32, 3.2, 0.08, topHex, 1), { pos: [x, topY, z] }),
    transformGeo(rcyl(0.18, 0.22, 2.75, PALETTE.woodWalnut, 8), { pos: [x - 1.85, floorY + 1.38, z - 1.15] }),
    transformGeo(rcyl(0.18, 0.22, 2.75, PALETTE.woodWalnut, 8), { pos: [x + 1.85, floorY + 1.38, z - 1.15] }),
    transformGeo(rcyl(0.18, 0.22, 2.75, PALETTE.woodWalnut, 8), { pos: [x - 1.85, floorY + 1.38, z + 1.15] }),
    transformGeo(rcyl(0.18, 0.22, 2.75, PALETTE.woodWalnut, 8), { pos: [x + 1.85, floorY + 1.38, z + 1.15] })
  );
  // Two charming bistro chairs flanking the table
  for (const s of [-1, 1] as const) {
    const cx = x + s * 3.15;
    parts.push(
      transformGeo(rbox(1.5, 0.22, 1.5, 0.06, chairHex, 1), { pos: [cx, floorY + 1.65, z] }),
      transformGeo(rbox(0.22, 2.1, 1.45, 0.05, chairHex, 1), { pos: [cx + s * 0.65, floorY + 2.65, z] }),
      transformGeo(rbox(1.3, 1.6, 1.3, 0.06, PALETTE.woodOak, 1), { pos: [cx, floorY + 0.82, z] })
    );
  }
  if (addCollider) {
    physics.addStaticBox(new THREE.Vector3(x, floorY + 1.5, z), new THREE.Vector3(2.3, 1.5, 1.6));
  }
  perches.addStaticSegment(
    `${id}_table`,
    new THREE.Vector3(x - 1.8, topY + 0.18, z),
    new THREE.Vector3(x + 1.8, topY + 0.18, z),
    0.04,
    'wood'
  );
}

function addBookshelf(
  parts: THREE.BufferGeometry[],
  glowParts: THREE.BufferGeometry[],
  physics: PhysicsWorld,
  x: number,
  floorY: number,
  z: number,
  rotY: number,
  width: number,
  height: number,
  addCollider = true
): void {
  const cosR = Math.cos(rotY);
  const sinR = Math.sin(rotY);
  const depth = 1.65;
  parts.push(
    transformGeo(rbox(width, height, depth, 0.08, PALETTE.woodWalnut, 1), {
      rot: [0, rotY, 0],
      pos: [x, floorY + height * 0.5, z],
    })
  );
  const spineCols = [
    PALETTE.tulipCoral,
    PALETTE.awningCobalt,
    PALETTE.ginkgoGold,
    PALETTE.parisGreen,
    PALETTE.lavenderSprig,
  ];
  const shelfRows = Math.max(2, Math.floor((height - 1.2) / 2.2));
  const booksPerRow = Math.max(3, Math.floor((width - 0.8) / 1.1));
  for (let r = 0; r < shelfRows; r++) {
    const sy = floorY + 1.35 + r * 2.15;
    for (let b = 0; b < booksPerRow; b++) {
      const lx = -((booksPerRow - 1) * 0.95) * 0.5 + b * 0.95;
      const col = spineCols[(r * 3 + b) % spineCols.length];
      parts.push(
        transformGeo(rbox(0.75, 1.45, 0.45, 0.04, col, 1), {
          rot: [0, rotY, 0],
          pos: [x + cosR * lx + sinR * (depth * 0.45), sy, z - sinR * lx + cosR * (depth * 0.45)],
        })
      );
    }
  }
  // Small glowing brass book-lamp on top of shelf
  glowParts.push(
    transformGeo(smoothSphere(0.45, PALETTE.goldGlow, 8, 6), {
      pos: [x, floorY + height + 0.45, z],
    })
  );
  if (addCollider) {
    physics.addStaticBox(
      new THREE.Vector3(x, floorY + height * 0.5, z),
      new THREE.Vector3(width * 0.5, height * 0.5, depth * 0.5),
      new THREE.Euler(0, rotY, 0)
    );
  }
}

function addCozySofa(
  parts: THREE.BufferGeometry[],
  physics: PhysicsWorld,
  x: number,
  floorY: number,
  z: number,
  rotY: number,
  fabricHex: number,
  addCollider = true
): void {
  parts.push(
    transformGeo(rbox(6.2, 1.55, 2.8, 0.18, fabricHex, 1), {
      rot: [0, rotY, 0],
      pos: [x, floorY + 1.05, z],
    }),
    transformGeo(rbox(6.2, 2.4, 0.65, 0.16, fabricHex, 1), {
      rot: [0, rotY, 0],
      pos: [x - Math.sin(rotY) * 1.08, floorY + 2.25, z - Math.cos(rotY) * 1.08],
    }),
    transformGeo(rbox(0.65, 1.85, 2.8, 0.14, PALETTE.woodOak, 1), {
      rot: [0, rotY, 0],
      pos: [x - Math.cos(rotY) * 2.85, floorY + 1.45, z + Math.sin(rotY) * 2.85],
    }),
    transformGeo(rbox(0.65, 1.85, 2.8, 0.14, PALETTE.woodOak, 1), {
      rot: [0, rotY, 0],
      pos: [x + Math.cos(rotY) * 2.85, floorY + 1.45, z - Math.sin(rotY) * 2.85],
    })
  );
  if (addCollider) {
    physics.addStaticBox(
      new THREE.Vector3(x, floorY + 1.3, z),
      new THREE.Vector3(3.1, 1.3, 1.4),
      new THREE.Euler(0, rotY, 0)
    );
  }
}

function addPottedPlant(
  parts: THREE.BufferGeometry[],
  x: number,
  floorY: number,
  z: number,
  scale = 1.0
): void {
  parts.push(
    transformGeo(rcyl(0.75 * scale, 0.55 * scale, 1.45 * scale, PALETTE.brickTerracotta, 10), {
      pos: [x, floorY + 0.72 * scale, z],
    }),
    transformGeo(rcyl(0.14 * scale, 0.18 * scale, 2.2 * scale, PALETTE.trunkBark, 8), {
      pos: [x, floorY + 2.1 * scale, z],
    }),
    transformGeo(smoothSphere(1.15 * scale, PALETTE.leafSage, 10, 8, [1.0, 1.25, 1.0]), {
      pos: [x, floorY + 3.6 * scale, z],
    })
  );
}

function addWallPainting(
  parts: THREE.BufferGeometry[],
  x: number,
  y: number,
  z: number,
  rotY: number,
  w: number,
  h: number,
  skyHex: number,
  landHex: number
): void {
  const nx = Math.sin(rotY);
  const nz = Math.cos(rotY);
  parts.push(
    transformGeo(rbox(w + 0.45, h + 0.45, 0.18, 0.04, PALETTE.brassWarm, 1), {
      rot: [0, rotY, 0],
      pos: [x, y, z],
    }),
    transformGeo(rbox(w, h * 0.55, 0.2, 0.02, skyHex, 1), {
      rot: [0, rotY, 0],
      pos: [x + nx * 0.04, y + h * 0.2, z + nz * 0.04],
    }),
    transformGeo(rbox(w, h * 0.42, 0.2, 0.02, landHex, 1), {
      rot: [0, rotY, 0],
      pos: [x + nx * 0.04, y - h * 0.26, z + nz * 0.04],
    })
  );
}

/**
 * Populates multi-story floor slabs with open vertical stairwell shafts,
 * stairs, ceiling beams/perches, warm glowing chandeliers, and themed European furniture
 * inside any hollow townhouse.
 */
export function populateTownhouseInterior(opts: TownhouseInteriorOptions): void {
  const {
    id,
    innerXMin,
    innerXMax,
    innerZMin,
    innerZMax,
    baseY,
    groundH,
    upperFloorH,
    floors,
    frontFace,
    parts,
    glowParts,
    physics,
    perches,
    isPerimeter,
    avoidRect,
  } = opts;

  const iw = innerXMax - innerXMin;
  const idLen = innerZMax - innerZMin;
  if (iw < 6.0 || idLen < 6.0) return;

  const icx = (innerXMin + innerXMax) * 0.5;
  const icz = (innerZMin + innerZMax) * 0.5;
  const wallH = groundH + (floors - 1) * upperFloorH;
  const theme = pickTheme(id);

  // Register this building's interior volume for camera & audio indoor detection
  registerBuildingInterior({
    xMin: innerXMin - 0.1,
    xMax: innerXMax + 0.1,
    yMin: baseY,
    yMax: baseY + wallH - 0.2,
    zMin: innerZMin - 0.1,
    zMax: innerZMax + 0.1,
  });

  // Ground Floor finished herringbone wood/tile inlay (sits cleanly at y = baseY + 0.05)
  const floorTileHex = theme === 'patisserie' || theme === 'bookshop' ? PALETTE.woodOak : PALETTE.woodBirch;
  parts.push(
    transformGeo(rbox(iw - 0.08, 0.1, idLen - 0.08, 0.02, floorTileHex, 1), {
      pos: [icx, baseY + 0.05, icz],
    })
  );

  // Determine stairwell / fly-through shaft in a rear corner opposite `frontFace`
  const holeW = Math.min(7.8, Math.max(4.4, iw * 0.30));
  const holeD = Math.min(7.8, Math.max(4.4, idLen * 0.40));
  const holeOnMaxX = frontFace !== 'east';
  const holeOnMaxZ = frontFace !== 'north';
  const hx0 = holeOnMaxX ? innerXMax - holeW : innerXMin;
  const hx1 = holeOnMaxX ? innerXMax : innerXMin + holeW;
  const hz0 = holeOnMaxZ ? innerZMax - holeD : innerZMin;
  const hz1 = holeOnMaxZ ? innerZMax : innerZMin + holeD;

  // Compute remaining 2 non-overlapping floor-slab rectangles around the stairwell shaft
  const slabA = {
    x0: holeOnMaxX ? innerXMin : hx1,
    x1: holeOnMaxX ? hx0 : innerXMax,
    z0: innerZMin,
    z1: innerZMax,
  };
  const slabB = {
    x0: hx0,
    x1: hx1,
    z0: holeOnMaxZ ? innerZMin : hz1,
    z1: holeOnMaxZ ? hz0 : innerZMax,
  };

  // Safe main living area center (inside slabA, clear of stairwell shaft & walls)
  const mainCx = (slabA.x0 + slabA.x1) * 0.5;
  const mainCz = (slabA.z0 + slabA.z1) * 0.5;
  const mainW = slabA.x1 - slabA.x0;
  const mainD = slabA.z1 - slabA.z0;

  // Build Upper Floor Slabs (`f = 1 .. floors - 1`) + Staircase + Ceiling Slab (`f = floors`)
  for (let f = 1; f <= floors; f++) {
    const slabTopY = f === floors ? baseY + wallH : baseY + groundH + (f - 1) * upperFloorH;
    const slabThick = 0.6;
    const slabCenterY = slabTopY - slabThick * 0.5;

    if (f === floors) {
      // Top ceiling slab (solid underside for top floor)
      parts.push(
        transformGeo(rbox(iw, slabThick, idLen, 0.08, PALETTE.wallCreamTrim, 1), {
          pos: [icx, slabCenterY, icz],
        })
      );
      const ceilCol = physics.addStaticBox(
        new THREE.Vector3(icx, slabCenterY, icz),
        new THREE.Vector3(iw * 0.5, slabThick * 0.5, idLen * 0.5)
      );
      physics.setBumpMetadata(ceilCol, { surface: 'wood', causesDizzy: false });
      continue;
    }

    // Two non-overlapping slabs around the stairwell hole
    for (const s of [slabA, slabB]) {
      const sw = s.x1 - s.x0;
      const sd = s.z1 - s.z0;
      if (sw < 0.6 || sd < 0.6) continue;
      const sx = (s.x0 + s.x1) * 0.5;
      const sz = (s.z0 + s.z1) * 0.5;
      parts.push(
        transformGeo(rbox(sw, slabThick, sd, 0.06, PALETTE.woodOak, 1), {
          pos: [sx, slabCenterY, sz],
        })
      );
      const col = physics.addStaticBox(
        new THREE.Vector3(sx, slabCenterY, sz),
        new THREE.Vector3(sw * 0.5, slabThick * 0.5, sd * 0.5)
      );
      physics.setBumpMetadata(col, { surface: 'wood', causesDizzy: false });
    }

    // Stairwell protective railing along the inner open edge + wooden flight of steps inside shaft
    const railX = holeOnMaxX ? hx0 : hx1;
    const railZ = holeOnMaxZ ? hz0 : hz1;
    parts.push(
      transformGeo(rbox(0.22, 2.2, holeD, 0.04, PALETTE.ironworkPlum, 1), {
        pos: [railX, slabTopY + 1.1, (hz0 + hz1) * 0.5],
      }),
      transformGeo(rbox(holeW, 2.2, 0.22, 0.04, PALETTE.ironworkPlum, 1), {
        pos: [(hx0 + hx1) * 0.5, slabTopY + 1.1, railZ],
      })
    );
    perches.addStaticSegment(
      `${id}_stair_rail_${f}`,
      new THREE.Vector3(railX, slabTopY + 2.22, hz0 + 0.4),
      new THREE.Vector3(railX, slabTopY + 2.22, hz1 - 0.4),
      0.07,
      'metal'
    );

    // Angled stair ramp geometry connecting previous floor up to `slabTopY` inside the stairwell hole
    const prevFloorY = f === 1 ? baseY : baseY + groundH + (f - 2) * upperFloorH;
    const stairRise = slabTopY - prevFloorY;
    const stairRun = Math.max(4.0, holeD - 0.8);
    const stairDiag = Math.hypot(stairRise, stairRun);
    const stairAngle = Math.atan2(stairRise, stairRun);
    const stairDirZ = holeOnMaxZ ? 1 : -1;
    parts.push(
      transformGeo(rbox(Math.min(3.2, holeW * 0.55), 0.45, stairDiag, 0.06, PALETTE.woodWalnut, 1), {
        rot: [stairDirZ * stairAngle, 0, 0],
        pos: [(hx0 + hx1) * 0.5, (prevFloorY + slabTopY) * 0.5, (hz0 + hz1) * 0.5],
      })
    );
  }

  // Interior Cream Wainscoting Trim on rear wall (visual depth)
  const backWallX = frontFace === 'east' ? innerXMin + 0.14 : frontFace === 'west' ? innerXMax - 0.14 : icx;
  const backWallZ = frontFace === 'north' ? innerZMin + 0.14 : frontFace === 'south' ? innerZMax - 0.14 : icz;
  const backAlongZ = frontFace === 'east' || frontFace === 'west';
  parts.push(
    transformGeo(
      rbox(backAlongZ ? 0.26 : iw - 0.4, 4.2, backAlongZ ? idLen - 0.4 : 0.26, 0.06, PALETTE.wallCreamTrim, 1),
      { pos: [backWallX, baseY + 2.1, backWallZ] }
    )
  );

  // Furnish every story `f = 0 .. floors - 1`
  const maxFurnishedFloor = isPerimeter ? Math.min(floors, 4) : floors;
  for (let f = 0; f < maxFurnishedFloor; f++) {
    const floorY = f === 0 ? baseY : baseY + groundH + (f - 1) * upperFloorH;
    const storyH = f === 0 ? groundH : upperFloorH;
    const ceilingY = floorY + storyH - 0.6;

    // 1. Warm Hanging Brass Chandelier + Exposed Walnut Rafter Beam with Perches
    if (!rectsOverlap(mainCx - 1.5, mainCx + 1.5, mainCz - 1.5, mainCz + 1.5, avoidRect)) {
      addPendantChandelier(
        parts,
        glowParts,
        perches,
        `${id}_chandelier_f${f}`,
        mainCx,
        ceilingY,
        mainCz,
        f === 0 ? 4.4 : 2.9
      );
    }

    const beamY = ceilingY - 0.85;
    if (mainW >= mainD) {
      parts.push(
        transformGeo(rbox(0.75, 0.8, idLen - 0.4, 0.08, PALETTE.woodWalnut, 1), {
          pos: [mainCx, beamY, icz],
        })
      );
      perches.addStaticSegment(
        `${id}_beam_f${f}`,
        new THREE.Vector3(mainCx, beamY + 0.42, innerZMin + 1.2),
        new THREE.Vector3(mainCx, beamY + 0.42, innerZMax - 1.2),
        0.04,
        'wood'
      );
    } else {
      parts.push(
        transformGeo(rbox(iw - 0.4, 0.8, 0.75, 0.08, PALETTE.woodWalnut, 1), {
          pos: [icx, beamY, mainCz],
        })
      );
      perches.addStaticSegment(
        `${id}_beam_f${f}`,
        new THREE.Vector3(innerXMin + 1.2, beamY + 0.42, mainCz),
        new THREE.Vector3(innerXMax - 1.2, beamY + 0.42, mainCz),
        0.04,
        'wood'
      );
    }

    // 2. Woven Area Rug + Center Furniture (kept clear of chimney/avoidRect & front entrance)
    const rugW = Math.max(4.5, Math.min(11.0, mainW * 0.58));
    const rugD = Math.max(4.5, Math.min(11.0, mainD * 0.56));
    const rugOuter = f % 2 === 0 ? PALETTE.awningCoral : PALETTE.awningCobalt;
    const rugInner = f % 2 === 0 ? PALETTE.awningGold : PALETTE.wallCreamTrim;
    if (!rectsOverlap(mainCx - rugW * 0.5, mainCx + rugW * 0.5, mainCz - rugD * 0.5, mainCz + rugD * 0.5, avoidRect)) {
      addRug(parts, mainCx, floorY, mainCz, rugW, rugD, rugOuter, rugInner);
    }

    // Place back-wall furniture (bookshelf / display counter / sofa) safely offset from front doorway
    const backOffsetX = frontFace === 'east' ? slabA.x0 + 1.8 : frontFace === 'west' ? slabA.x1 - 1.8 : mainCx;
    const backOffsetZ = frontFace === 'north' ? slabA.z0 + 1.8 : frontFace === 'south' ? slabA.z1 - 1.8 : mainCz;
    const backYaw =
      frontFace === 'east'
        ? Math.PI * 0.5
        : frontFace === 'west'
          ? -Math.PI * 0.5
          : frontFace === 'north'
            ? 0
            : Math.PI;

    const backFree = !rectsOverlap(backOffsetX - 3.0, backOffsetX + 3.0, backOffsetZ - 3.0, backOffsetZ + 3.0, avoidRect);
    const centerFree = !rectsOverlap(mainCx - 2.6, mainCx + 2.6, mainCz - 2.2, mainCz + 2.2, avoidRect);

    if (f === 0) {
      // Ground-floor thematic centerpiece
      if (theme === 'bookshop' && backFree) {
        addBookshelf(
          parts,
          glowParts,
          physics,
          backOffsetX,
          floorY,
          backOffsetZ,
          backYaw,
          Math.min(8.5, (backAlongZ ? mainD : mainW) * 0.65),
          10.8,
          !isPerimeter
        );
      } else if (theme === 'roastery' && backFree) {
        // Copper roaster drum & marble espresso counter
        parts.push(
          transformGeo(rcyl(1.45, 1.65, 5.2, PALETTE.roofTerracotta, 12), {
            pos: [backOffsetX, floorY + 2.6, backOffsetZ],
          }),
          transformGeo(rcyl(1.75, 1.75, 0.5, PALETTE.brassWarm, 12), {
            pos: [backOffsetX, floorY + 5.3, backOffsetZ],
          }),
          transformGeo(rbox(2.2, 2.0, 2.2, 0.14, PALETTE.woodBirch, 1), {
            pos: [backOffsetX + (backAlongZ ? 0 : 3.2), floorY + 1.0, backOffsetZ + (backAlongZ ? 3.2 : 0)],
          })
        );
      } else if (theme === 'patisserie' && backFree) {
        // Bakery display counter & glowing brick oven
        parts.push(
          transformGeo(rbox(7.2, 3.6, 2.4, 0.14, PALETTE.porcelainWhite, 1), {
            rot: [0, backYaw, 0],
            pos: [backOffsetX, floorY + 1.8, backOffsetZ],
          }),
          transformGeo(rbox(7.6, 0.38, 2.7, 0.08, PALETTE.woodOak, 1), {
            rot: [0, backYaw, 0],
            pos: [backOffsetX, floorY + 3.7, backOffsetZ],
          })
        );
      } else if (backFree) {
        addCozySofa(
          parts,
          physics,
          backOffsetX,
          floorY,
          backOffsetZ,
          backYaw,
          theme === 'conservatory' ? PALETTE.parisGreen : PALETTE.coatRose,
          !isPerimeter
        );
      }

      if (centerFree && mainW >= 9.0 && mainD >= 8.5) {
        addWoodTableAndChairs(
          parts,
          physics,
          perches,
          `${id}_gtable`,
          mainCx,
          floorY,
          mainCz,
          PALETTE.woodOak,
          theme === 'bistro' ? PALETTE.awningCoral : PALETTE.shutterTeal,
          !isPerimeter
        );
      }
    } else {
      // Upper floor living room / gallery / library
      if (backFree) {
        if ((f + hashString(id)) % 2 === 0) {
          addBookshelf(
            parts,
            glowParts,
            physics,
            backOffsetX,
            floorY,
            backOffsetZ,
            backYaw,
            Math.min(7.5, (backAlongZ ? mainD : mainW) * 0.55),
            9.2,
            !isPerimeter
          );
        } else {
          addCozySofa(
            parts,
            physics,
            backOffsetX,
            floorY,
            backOffsetZ,
            backYaw,
            f % 2 === 1 ? PALETTE.awningCobalt : PALETTE.coatRose,
            !isPerimeter
          );
        }
      }
      if (centerFree && mainW >= 8.5 && mainD >= 8.0) {
        addWoodTableAndChairs(
          parts,
          physics,
          perches,
          `${id}_table_f${f}`,
          mainCx,
          floorY,
          mainCz,
          PALETTE.woodBirch,
          PALETTE.awningGold,
          !isPerimeter
        );
      }
    }

    // Framed wall painting & potted plant on upper/ground back walls
    if (backFree) {
      addWallPainting(
        parts,
        backWallX,
        floorY + (f === 0 ? 11.2 : 9.4),
        backWallZ,
        backYaw,
        4.4,
        3.6,
        f % 2 === 0 ? PALETTE.skyMidDawn : PALETTE.ginkgoGold,
        f % 2 === 0 ? PALETTE.leafSage : PALETTE.roofTerracotta
      );
    }

    const plantX = slabA.x0 + 1.8;
    const plantZ = slabA.z0 + 1.8;
    if (!rectsOverlap(plantX - 1.2, plantX + 1.2, plantZ - 1.2, plantZ + 1.2, avoidRect)) {
      addPottedPlant(parts, plantX, floorY, plantZ, f === 0 ? 1.15 : 0.95);
    }
  }
}

/**
 * Populates the NW Boulangerie Ground Floor (`y: 0.28..25.4`) and 3rd/4th Story Bohemian Loft (`y: 53.2..75.0`).
 */
export function buildNWBoulangerieExtraInteriors(
  parts: THREE.BufferGeometry[],
  glowParts: THREE.BufferGeometry[],
  physics: PhysicsWorld,
  perches: PerchSystem
): void {
  // 1. Ground Floor Boulangerie-Patisserie (`x: -86.8..-39.2, z: 25.2..78.8, y: 0.28..25.3`)
  registerBuildingInterior({
    xMin: -86.8,
    xMax: -39.2,
    yMin: 0.28,
    yMax: 25.3,
    zMin: 25.2,
    zMax: 78.8,
  });

  // Checkered warm tiled floor finish + cream wainscoting
  parts.push(
    transformGeo(rbox(47.2, 0.12, 53.2, 0.04, PALETTE.porcelainWhite, 1), {
      pos: [-63.0, 0.34, 52.0],
    }),
    transformGeo(rbox(28.0, 0.14, 34.0, 0.04, PALETTE.awningCoral, 1), {
      pos: [-61.0, 0.35, 52.0],
    }),
    transformGeo(rbox(23.0, 0.15, 29.0, 0.04, PALETTE.awningGold, 1), {
      pos: [-61.0, 0.36, 52.0],
    }),
    // West wall brick baker's oven hearth + glowing embers
    transformGeo(rbox(5.6, 13.5, 13.5, 0.22, PALETTE.brickTerracotta, 1), {
      pos: [-83.8, 7.0, 52.0],
    }),
    transformGeo(rbox(3.8, 4.6, 6.2, 0.14, PALETTE.ironworkPlum, 1), {
      pos: [-81.0, 4.2, 52.0],
    }),
    // Marble & Oak L-shaped Pastry Counter (`x = -62, z = 44..68`)
    transformGeo(rbox(4.2, 4.2, 24.0, 0.16, PALETTE.woodOak, 1), {
      pos: [-62.0, 2.38, 56.0],
    }),
    transformGeo(rbox(4.8, 0.48, 24.6, 0.1, PALETTE.porcelainWhite, 1), {
      pos: [-62.0, 4.62, 56.0],
    }),
    // Wooden baguette & bread shelves behind counter
    transformGeo(rbox(2.2, 11.5, 14.0, 0.12, PALETTE.woodWalnut, 1), {
      pos: [-74.0, 6.0, 65.0],
    }),
    transformGeo(rbox(2.2, 11.5, 14.0, 0.12, PALETTE.woodWalnut, 1), {
      pos: [-74.0, 6.0, 39.0],
    })
  );
  glowParts.push(
    transformGeo(rbox(1.4, 2.6, 4.6, 0.12, PALETTE.goldGlow, 1), {
      pos: [-79.6, 3.8, 52.0],
    })
  );
  physics.addStaticBox(new THREE.Vector3(-83.8, 7.0, 52.0), new THREE.Vector3(2.8, 6.75, 6.75));
  physics.addStaticBox(new THREE.Vector3(-62.0, 2.5, 56.0), new THREE.Vector3(2.4, 2.4, 12.3));
  physics.addStaticBox(new THREE.Vector3(-74.0, 6.0, 65.0), new THREE.Vector3(1.1, 5.75, 7.0));
  physics.addStaticBox(new THREE.Vector3(-74.0, 6.0, 39.0), new THREE.Vector3(1.1, 5.75, 7.0));

  addWoodTableAndChairs(parts, physics, perches, 'boulangerie_in_t1', -50.0, 0.38, 35.5, PALETTE.woodOak, PALETTE.parisGreen, true);
  addWoodTableAndChairs(parts, physics, perches, 'boulangerie_in_t2', -50.0, 0.38, 68.5, PALETTE.woodOak, PALETTE.awningCoral, true);
  addPottedPlant(parts, -44.0, 0.38, 30.0, 1.3);
  addPottedPlant(parts, -44.0, 0.38, 74.0, 1.3);

  addPendantChandelier(parts, glowParts, perches, 'boulangerie_chand_1', -56.0, 25.0, 42.0, 4.2);
  addPendantChandelier(parts, glowParts, perches, 'boulangerie_chand_2', -56.0, 25.0, 62.0, 4.2);
  for (const rz of [34.0, 46.0, 58.0, 70.0]) {
    parts.push(
      transformGeo(rbox(46.0, 0.85, 0.9, 0.1, PALETTE.woodWalnut, 1), {
        pos: [-63.0, 23.8, rz],
      })
    );
    perches.addStaticSegment(
      `boulangerie_gf_rafter_${rz}`,
      new THREE.Vector3(-82.0, 24.22, rz),
      new THREE.Vector3(-42.0, 24.22, rz),
      0.04,
      'wood'
    );
  }

  // 2. Upper 3rd/4th Story Bohemian Loft above Atelier (`x: -86.8..-39.2, z: 25.2..78.8, y: 53.2..74.8`)
  registerBuildingInterior({
    xMin: -86.8,
    xMax: -39.2,
    yMin: 53.2,
    yMax: 74.8,
    zMin: 25.2,
    zMax: 78.8,
  });
  parts.push(
    transformGeo(rbox(47.2, 0.18, 53.2, 0.04, PALETTE.woodOak, 1), {
      pos: [-63.0, 53.26, 52.0],
    })
  );
  addRug(parts, -60.0, 53.35, 52.0, 24.0, 28.0, PALETTE.awningCobalt, PALETTE.awningGold);
  addCozySofa(parts, physics, -74.0, 53.35, 52.0, Math.PI * 0.5, PALETTE.coatRose, true);
  addWoodTableAndChairs(parts, physics, perches, 'nw_loft_table', -58.0, 53.35, 52.0, PALETTE.woodBirch, PALETTE.shutterTeal, true);
  addBookshelf(parts, glowParts, physics, -63.0, 53.35, 76.0, Math.PI, 12.0, 10.5, true);
  addBookshelf(parts, glowParts, physics, -63.0, 53.35, 28.0, 0, 12.0, 10.5, true);
  addWallPainting(parts, -86.0, 64.0, 52.0, Math.PI * 0.5, 8.2, 6.4, PALETTE.skyMidDawn, PALETTE.leafSage);
  addPottedPlant(parts, -44.0, 53.35, 31.0, 1.25);
  addPottedPlant(parts, -44.0, 53.35, 73.0, 1.25);
  addPendantChandelier(parts, glowParts, perches, 'nw_loft_chand_1', -60.0, 74.6, 41.0, 3.8);
  addPendantChandelier(parts, glowParts, perches, 'nw_loft_chand_2', -60.0, 74.6, 63.0, 3.8);
  for (const rz of [34.0, 52.0, 70.0]) {
    parts.push(
      transformGeo(rbox(46.0, 0.85, 0.9, 0.1, PALETTE.woodWalnut, 1), {
        pos: [-63.0, 73.2, rz],
      })
    );
    perches.addStaticSegment(
      `nw_loft_rafter_${rz}`,
      new THREE.Vector3(-82.0, 73.62, rz),
      new THREE.Vector3(-42.0, 73.62, rz),
      0.04,
      'wood'
    );
  }
}

/**
 * Builds the soaring hollow Renaissance Clocktower interior (`tx = 96, tz = -96`)
 * with timber galleries, giant brass pendulum & gears, glowing wall lanterns,
 * and an open belfry hatch up to the Bronze Bell (`y = 95.8..113.4`).
 */
export function buildClocktowerInterior(
  tx: number,
  tz: number,
  parts: THREE.BufferGeometry[],
  glowParts: THREE.BufferGeometry[],
  physics: PhysicsWorld,
  perches: PerchSystem
): void {
  registerBuildingInterior({
    xMin: tx - 9.8,
    xMax: tx + 9.8,
    yMin: 0.28,
    yMax: 95.0,
    zMin: tz - 9.8,
    zMax: tz + 9.8,
  });

  // Checkered limestone & rose stone entrance floor
  parts.push(
    transformGeo(rbox(19.2, 0.24, 19.2, 0.04, PALETTE.plazaRoseStone, 1), {
      pos: [tx, 0.36, tz],
    }),
    transformGeo(rbox(11.0, 0.26, 11.0, 0.04, PALETTE.wallCreamTrim, 1), {
      pos: [tx, 0.37, tz],
    })
  );

  // Perimeter timber balconies at y = 26, 46, 74 (each leaves a 10x10 SU open vertical center shaft!)
  for (const [lvl, gy, halfOuter] of [
    [1, 26.0, 9.4],
    [2, 46.0, 9.4],
    [3, 74.0, 8.2],
  ] as const) {
    const holeHalf = 5.0;
    const stripW = halfOuter - holeHalf;
    const edgeMid = holeHalf + stripW * 0.5;
    const slabs: Array<[number, number, number, number]> = [
      [tx, tz + edgeMid, halfOuter * 2, stripW],
      [tx, tz - edgeMid, halfOuter * 2, stripW],
      [tx - edgeMid, tz, stripW, holeHalf * 2],
      [tx + edgeMid, tz, stripW, holeHalf * 2],
    ];
    for (const [sx, sz, sw, sd] of slabs) {
      parts.push(
        transformGeo(rbox(sw, 0.65, sd, 0.08, PALETTE.woodOak, 1), { pos: [sx, gy - 0.32, sz] })
      );
      physics.addStaticBox(new THREE.Vector3(sx, gy - 0.32, sz), new THREE.Vector3(sw * 0.5, 0.32, sd * 0.5));
    }

    // Timber crossbeam & inner railing perch
    parts.push(
      transformGeo(rbox(halfOuter * 1.9, 0.55, 0.55, 0.06, PALETTE.woodWalnut, 1), {
        pos: [tx, gy - 0.1, tz - holeHalf],
      }),
      transformGeo(rbox(halfOuter * 1.9, 0.55, 0.55, 0.06, PALETTE.woodWalnut, 1), {
        pos: [tx, gy - 0.1, tz + holeHalf],
      })
    );
    perches.addStaticSegment(
      `clocktower_in_beam_s_${lvl}`,
      new THREE.Vector3(tx - 4.8, gy + 0.2, tz - holeHalf),
      new THREE.Vector3(tx + 4.8, gy + 0.2, tz - holeHalf),
      0.06,
      'wood'
    );
    perches.addStaticSegment(
      `clocktower_in_beam_n_${lvl}`,
      new THREE.Vector3(tx - 4.8, gy + 0.2, tz + holeHalf),
      new THREE.Vector3(tx + 4.8, gy + 0.2, tz + holeHalf),
      0.06,
      'wood'
    );

    // Glowing brass wall lanterns inside the shaft
    for (const [lx, lz] of [
      [tx - halfOuter + 1.0, tz - halfOuter + 1.0],
      [tx + halfOuter - 1.0, tz + halfOuter - 1.0],
    ]) {
      glowParts.push(
        transformGeo(smoothSphere(0.75, PALETTE.goldGlow, 10, 8), { pos: [lx, gy + 5.5, lz] })
      );
    }
  }

  // Giant Brass Clockwork Pendulum & Golden Gear Wheels inside the central shaft
  parts.push(
    transformGeo(rcyl(0.24, 0.24, 34.0, PALETTE.brassWarm, 10), { pos: [tx, 46.0, tz] }),
    transformGeo(rcyl(2.6, 2.6, 0.75, PALETTE.goldGlow, 18), {
      rot: [Math.PI * 0.5, 0, 0],
      pos: [tx, 28.0, tz],
    }),
    transformGeo(rcyl(3.8, 3.8, 0.65, PALETTE.brassWarm, 20), {
      rot: [Math.PI * 0.5, 0, 0],
      pos: [tx - 1.8, 70.0, tz],
    }),
    transformGeo(rcyl(2.5, 2.5, 0.65, PALETTE.goldGlow, 16), {
      rot: [0, 0, Math.PI * 0.5],
      pos: [tx + 2.2, 74.5, tz - 1.2],
    })
  );
  perches.addStaticSegment(
    'clocktower_pendulum_bar',
    new THREE.Vector3(tx - 2.2, 30.8, tz),
    new THREE.Vector3(tx + 2.2, 30.8, tz),
    0.08,
    'metal'
  );
  glowParts.push(
    transformGeo(smoothSphere(0.95, PALETTE.goldGlow, 10, 8), { pos: [tx, 14.0, tz] })
  );
}

/**
 * Populates a hollow Corner Rotunda Tower (`(cx, cz)`) with circular landings,
 * glowing brass chandelier, table, potted plant, and perches.
 */
export function buildRotundaInterior(
  id: string,
  cx: number,
  cz: number,
  parts: THREE.BufferGeometry[],
  glowParts: THREE.BufferGeometry[],
  physics: PhysicsWorld,
  perches: PerchSystem
): void {
  registerBuildingInterior({
    xMin: cx - 6.5,
    xMax: cx + 6.5,
    yMin: 0.28,
    yMax: 112.0,
    zMin: cz - 6.5,
    zMax: cz + 6.5,
  });

  parts.push(
    transformGeo(rcyl(6.2, 6.2, 0.2, PALETTE.woodOak, 16), { pos: [cx, 0.38, cz] })
  );
  addPendantChandelier(parts, glowParts, perches, `${id}_chand_0`, cx, 24.5, cz, 3.6);
  addPottedPlant(parts, cx + 2.5, 0.48, cz - 2.2, 1.0);

  for (const [lvl, ly] of [
    [1, 30.0],
    [2, 58.0],
    [3, 86.0],
  ] as const) {
    // Half-moon crescent gallery deck leaving open flight space on the inward side
    const offsetSignX = cx > 0 ? 1 : -1;
    const offsetSignZ = cz > 0 ? 1 : -1;
    parts.push(
      transformGeo(rbox(6.0, 0.55, 6.0, 0.1, PALETTE.woodOak, 1), {
        pos: [cx + offsetSignX * 1.4, ly - 0.28, cz + offsetSignZ * 1.4],
      }),
      transformGeo(rbox(0.55, 0.55, 11.4, 0.08, PALETTE.woodWalnut, 1), {
        pos: [cx, ly + 12.0, cz],
      })
    );
    physics.addStaticBox(
      new THREE.Vector3(cx + offsetSignX * 1.4, ly - 0.28, cz + offsetSignZ * 1.4),
      new THREE.Vector3(3.0, 0.28, 3.0)
    );
    perches.addStaticSegment(
      `${id}_beam_${lvl}`,
      new THREE.Vector3(cx, ly + 12.3, cz - 4.8),
      new THREE.Vector3(cx, ly + 12.3, cz + 4.8),
      0.04,
      'wood'
    );
    glowParts.push(
      transformGeo(smoothSphere(0.65, PALETTE.goldGlow, 10, 8), {
        pos: [cx, ly + 10.5, cz],
      })
    );
  }
}

/**
 * Populates the hollow Western Watergate Palazzo upper boathouse galleries (`x: -162..-147, z: -70..-38`).
 */
export function buildWatergateInterior(
  parts: THREE.BufferGeometry[],
  glowParts: THREE.BufferGeometry[],
  physics: PhysicsWorld,
  perches: PerchSystem
): void {
  registerBuildingInterior({
    xMin: -163.0,
    xMax: -146.5,
    yMin: 0.28,
    yMax: 109.5,
    zMin: -70.5,
    zMax: -37.5,
  });

  // Lower canal-side timber dock catwalk along the North & South inner piers
  for (const dz of [-41.8, -66.2]) {
    parts.push(
      transformGeo(rbox(14.0, 0.5, 4.2, 0.08, PALETTE.woodOak, 1), {
        pos: [-155.0, 1.25, dz],
      })
    );
    physics.addStaticBox(new THREE.Vector3(-155.0, 1.25, dz), new THREE.Vector3(7.0, 0.25, 2.1));
  }

  for (const [lvl, fy] of [
    [1, 28.5],
    [2, 50.0],
    [3, 70.0],
    [4, 90.0],
  ] as const) {
    // Two floor slabs leaving central lightwell open (`z: -58..-50`)
    for (const [sz, sd] of [
      [-64.0, 11.5],
      [-44.0, 11.5],
    ] as const) {
      parts.push(
        transformGeo(rbox(15.0, 0.65, sd, 0.08, PALETTE.woodOak, 1), {
          pos: [-155.0, fy - 0.32, sz],
        })
      );
      physics.addStaticBox(new THREE.Vector3(-155.0, fy - 0.32, sz), new THREE.Vector3(7.5, 0.32, sd * 0.5));
    }
    // Wooden crates/casks & hanging chandelier
    parts.push(
      transformGeo(rbox(2.4, 2.4, 2.4, 0.1, PALETTE.woodBirch, 1), {
        pos: [-158.0, fy + 1.2, -65.0],
      }),
      transformGeo(rbox(14.0, 0.6, 0.6, 0.06, PALETTE.woodWalnut, 1), {
        pos: [-155.0, fy + 14.5, -54.0],
      })
    );
    perches.addStaticSegment(
      `watergate_beam_${lvl}`,
      new THREE.Vector3(-161.0, fy + 14.82, -54.0),
      new THREE.Vector3(-148.5, fy + 14.82, -54.0),
      0.04,
      'wood'
    );
    glowParts.push(
      transformGeo(smoothSphere(0.7, PALETTE.goldGlow, 10, 8), {
        pos: [-154.0, fy + 12.2, -54.0],
      })
    );
  }
}
