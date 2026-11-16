import * as THREE from 'three/webgpu';
import { PALETTE } from '../rendering/Palette.ts';
import {
  paintGeometry,
  rbox,
  rcyl,
  transformGeo,
  mergeParts,
} from '../geometry/Sculptor.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { PerchSegment, PerchSystem } from './PerchSystem.ts';
import { populateTownhouseInterior } from './InteriorBuilder.ts';

export interface InteractiveWindowSpec {
  id: string;
  wx: number;
  wy: number;
  wz: number;
  rotY: number;
  axis: 'x' | 'z';
  sign: 1 | -1;
  shutterHex: number;
  isFlowerbox: boolean;
  sillPerch: PerchSegment;
}

export interface TownhouseVisibleFaces {
  north?: boolean;
  south?: boolean;
  east?: boolean;
  west?: boolean;
}

export interface TownhouseSpec {
  id: string;
  center: [number, number];
  widthX: number;
  depthZ: number;
  floors: number;
  wallHex: number;
  shutterHex: number;
  roofStyle: 'mansard' | 'terracotta';
  frontFace: 'east' | 'west' | 'north' | 'south';
  awningHex?: number;
  addPerches?: boolean;
  visibleFaces?: TownhouseVisibleFaces;
  minColliderTopY?: number;
  avoidInteriorRect?: { xMin: number; xMax: number; zMin: number; zMax: number };
}

export interface TownhouseBuildContext {
  root: THREE.Object3D;
  mat: THREE.Material;
  physics: PhysicsWorld;
  perches: PerchSystem;
  createBouncyAwning: (
    id: string,
    center: THREE.Vector3,
    halfExtents: THREE.Vector3,
    stripeA: number,
    stripeB: number,
    bounceSpeed: number
  ) => void;
  onFlowerboxSillCreated?: (seg: PerchSegment, center: THREE.Vector3) => void;
  registerInteractiveWindow?: (win: InteractiveWindowSpec) => void;
}

interface WallOpeningRect {
  uMin: number;
  uMax: number;
  yMin: number;
  yMax: number;
}

/**
 * Builds an indexed pitched mansard or hip roof geometry.
 */
export function buildPitchedHipRoofGeo(
  w: number,
  d: number,
  h: number,
  topRatio: number,
  hex: number
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(topRatio, 1.0, h, 4, 1);
  g.rotateY(Math.PI * 0.25);
  g.scale(w / Math.SQRT2, 1.0, d / Math.SQRT2);
  g.computeVertexNormals();
  const painted = paintGeometry(g, hex, { bottomAO: 0.13, topLift: 0.08 });
  g.dispose();
  return painted;
}

/**
 * Reusable Hollow & Enterable Haussmannian / Mediterranean Townhouse Generator:
 * - Builds hollow 4-wall exterior shells with genuine wall cutouts for ground doorways, shopfront
 *   bays, and open upper-floor French windows / balcony doors
 * - Populates multi-story interior floor slabs, vertical fly-through stairwells, staircases, beams,
 *   glowing chandeliers, and themed European furniture
 * - Enforces rear & roof perimeter bounds up to `minColliderTopY` so the city rim remains sealed
 */
export function buildDetailedTownhouse(
  spec: TownhouseSpec,
  ctx: TownhouseBuildContext,
  collectInto?: THREE.BufferGeometry[],
  glowCollectInto?: THREE.BufferGeometry[]
): THREE.Mesh | null {
  const [cx, cz] = spec.center;
  const w = spec.widthX;
  const d = spec.depthZ;
  const trim = PALETTE.wallCreamTrim;
  const groundH = 25.5;
  const upperFloorH = 18.2;
  const wallH = groundH + (spec.floors - 1) * upperFloorH;
  const baseY = 0.28;

  const vis = spec.visibleFaces;
  const faces = {
    north: vis ? vis.north === true : true,
    south: vis ? vis.south === true : true,
    east: vis ? vis.east === true : true,
    west: vis ? vis.west === true : true,
  };

  const parts: THREE.BufferGeometry[] = [];
  const localGlowParts: THREE.BufferGeometry[] = [];
  const glowTarget = glowCollectInto ?? localGlowParts;

  const frontAxis: 'x' | 'z' =
    spec.frontFace === 'east' || spec.frontFace === 'west' ? 'x' : 'z';
  const signFront: -1 | 1 =
    spec.frontFace === 'east' || spec.frontFace === 'north' ? 1 : -1;

  const isPerimeter = spec.minColliderTopY !== undefined;
  const axisDim = frontAxis === 'x' ? w : d;
  const perpSpan = frontAxis === 'x' ? d : w;
  const wallT = 1.1;
  const backWallT = isPerimeter ? Math.min(8.5, Math.max(wallT, axisDim * 0.3)) : wallT;

  const naturalColH = wallH + (spec.roofStyle === 'mansard' ? 13.4 : 10.6) * 0.72;
  const totalColH = isPerimeter
    ? Math.max(naturalColH, spec.minColliderTopY! - baseY)
    : naturalColH;

  // Compute hollow interior bounds
  const cFront = frontAxis === 'x' ? cx : cz;
  const cPerp = frontAxis === 'x' ? cz : cx;
  const frontInnerPlane = cFront + signFront * (axisDim * 0.5 - wallT);
  const backInnerPlane = cFront - signFront * (axisDim * 0.5 - backWallT);
  const axisInnerMin = Math.min(frontInnerPlane, backInnerPlane);
  const axisInnerMax = Math.max(frontInnerPlane, backInnerPlane);
  const perpInnerMin = cPerp - (perpSpan * 0.5 - wallT);
  const perpInnerMax = cPerp + (perpSpan * 0.5 - wallT);

  const innerXMin = frontAxis === 'x' ? axisInnerMin : perpInnerMin;
  const innerXMax = frontAxis === 'x' ? axisInnerMax : perpInnerMax;
  const innerZMin = frontAxis === 'x' ? perpInnerMin : axisInnerMin;
  const innerZMax = frontAxis === 'x' ? perpInnerMax : axisInnerMax;

  // --- 1. Solid Side Walls & Back Wall (Perimeter Rear Wall Extends Up To `totalColH`) ---
  const sideLen = Math.max(1.0, axisDim - wallT - backWallT);
  const sideCenterAxis = cFront - signFront * (backWallT - wallT) * 0.5;
  const backCenterAxis = cFront - signFront * (axisDim * 0.5 - backWallT * 0.5);

  const addWallBox = (
    bx: number,
    by: number,
    bz: number,
    sx: number,
    sy: number,
    sz: number,
    colH = sy,
    colCenterY = by,
    skipVisual = false
  ): void => {
    if (!skipVisual && sy > 0.05 && sx > 0.05 && sz > 0.05) {
      parts.push(
        transformGeo(rbox(sx, sy, sz, 0.16, spec.wallHex, 1, { bottomAO: 0.1 }), {
          pos: [bx, by, bz],
        })
      );
    }
    const body = ctx.physics.addStaticBox(
      new THREE.Vector3(bx, colCenterY, bz),
      new THREE.Vector3(sx * 0.5, colH * 0.5, sz * 0.5)
    );
    ctx.physics.setBumpMetadata(body, { surface: 'stone', causesDizzy: true });
  };

  // Back wall
  addWallBox(
    frontAxis === 'x' ? backCenterAxis : cx,
    baseY + wallH * 0.5,
    frontAxis === 'x' ? cz : backCenterAxis,
    frontAxis === 'x' ? backWallT : perpSpan,
    wallH,
    frontAxis === 'x' ? perpSpan : backWallT,
    totalColH,
    baseY + totalColH * 0.5
  );

  // Two side walls
  for (const sSide of [-1, 1] as const) {
    const sidePosPerp = cPerp + sSide * (perpSpan * 0.5 - wallT * 0.5);
    addWallBox(
      frontAxis === 'x' ? sideCenterAxis : sidePosPerp,
      baseY + wallH * 0.5,
      frontAxis === 'x' ? sidePosPerp : sideCenterAxis,
      frontAxis === 'x' ? sideLen : wallT,
      wallH,
      frontAxis === 'x' ? wallT : sideLen,
      isPerimeter ? totalColH : wallH,
      baseY + (isPerimeter ? totalColH : wallH) * 0.5
    );
  }

  // --- 2. Perforated Front Wall with Real Open Doorways, Shopfronts & Open Upper Windows ---
  const frontCenterAxis = cFront + signFront * (axisDim * 0.5 - wallT * 0.5);
  const frontCols = Math.max(2, Math.floor((perpSpan - 4.4) / 9.8));
  const frontSpacing = (perpSpan - 5.4) / Math.max(1, frontCols);
  const doorCol = Math.floor(frontCols * 0.5);
  const hasWalkoutBalconyFloor1 =
    spec.id === 'sw_painter_townhouse' || spec.id === 'se_buttercup_bookshop';

  const emitFrontWallSlab = (
    uMin: number,
    uMax: number,
    yMinLocal: number,
    yMaxLocal: number
  ): void => {
    const segW = uMax - uMin;
    const segH = yMaxLocal - yMinLocal;
    if (segW < 0.08 || segH < 0.08) return;
    const uMid = (uMin + uMax) * 0.5;
    const yMid = baseY + (yMinLocal + yMaxLocal) * 0.5;
    const bx = frontAxis === 'x' ? frontCenterAxis : cx + uMid;
    const bz = frontAxis === 'x' ? cz + uMid : frontCenterAxis;
    const sx = frontAxis === 'x' ? wallT : segW;
    const sz = frontAxis === 'x' ? segW : wallT;
    parts.push(
      transformGeo(rbox(sx, segH, sz, 0.14, spec.wallHex, 1, { bottomAO: 0.08 }), {
        pos: [bx, yMid, bz],
      })
    );
    const body = ctx.physics.addStaticBox(
      new THREE.Vector3(bx, yMid, bz),
      new THREE.Vector3(sx * 0.5, segH * 0.5, sz * 0.5)
    );
    ctx.physics.setBumpMetadata(body, { surface: 'stone', causesDizzy: true });
  };

  // Floor 0 (Ground floor `0 .. groundH`) openings
  const groundOpenings: WallOpeningRect[] = [];
  for (let c = 0; c < frontCols; c++) {
    const off = -((frontCols - 1) * frontSpacing) * 0.5 + c * frontSpacing;
    if (c === doorCol) {
      groundOpenings.push({ uMin: off - 2.75, uMax: off + 2.75, yMin: 0.0, yMax: 16.2 });
    } else {
      groundOpenings.push({ uMin: off - 2.45, uMax: off + 2.45, yMin: 4.8, yMax: 17.6 });
    }
  }

  const emitBandWithOpenings = (
    yBand0: number,
    yBand1: number,
    openings: WallOpeningRect[]
  ): void => {
    const sorted = [...openings].sort((a, b) => a.uMin - b.uMin);
    let cursorU = -perpSpan * 0.5;
    for (const op of sorted) {
      const clampedMin = Math.max(cursorU, op.uMin);
      const clampedMax = Math.min(perpSpan * 0.5, op.uMax);
      if (clampedMin - cursorU > 0.08) {
        emitFrontWallSlab(cursorU, clampedMin, yBand0, yBand1);
      }
      if (clampedMax > clampedMin + 0.08) {
        if (op.yMin > yBand0 + 0.08) {
          emitFrontWallSlab(clampedMin, clampedMax, yBand0, op.yMin);
        }
        if (op.yMax < yBand1 - 0.08) {
          emitFrontWallSlab(clampedMin, clampedMax, op.yMax, yBand1);
        }
      }
      cursorU = Math.max(cursorU, clampedMax);
    }
    if (perpSpan * 0.5 - cursorU > 0.08) {
      emitFrontWallSlab(cursorU, perpSpan * 0.5, yBand0, yBand1);
    }
  };

  emitBandWithOpenings(0, groundH, groundOpenings);

  // Upper Floors (`f = 1 .. floors - 1`) openings on frontFace
  for (let f = 1; f < spec.floors; f++) {
    const yBand0 = groundH + (f - 1) * upperFloorH;
    const yBand1 = yBand0 + upperFloorH;
    const floorOpenings: WallOpeningRect[] = [];
    for (let c = 0; c < frontCols; c++) {
      const off = -((frontCols - 1) * frontSpacing) * 0.5 + c * frontSpacing;
      const isCenter = c === doorCol;
      const isInteractiveShutterBay = Boolean(
        spec.addPerches && f === 1 && (f + c) % 3 !== 0 && !isCenter && ctx.registerInteractiveWindow
      );
      if (isCenter || !isInteractiveShutterBay) {
        const yMinOpen =
          f === 1 && isCenter && hasWalkoutBalconyFloor1 ? yBand0 + 0.05 : yBand0 + 3.0;
        floorOpenings.push({
          uMin: off - 1.95,
          uMax: off + 1.95,
          yMin: yMinOpen,
          yMax: yBand0 + 14.0,
        });
      }
    }
    emitBandWithOpenings(yBand0, yBand1, floorOpenings);
  }

  // Exterior corner rusticated limestone plinth pillars (kept strictly outside open doorway!)
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const px = cx + sx * (w * 0.5 - 0.5);
      const pz = cz + sz * (d * 0.5 - 0.5);
      parts.push(
        transformGeo(rbox(1.55, 5.6, 1.55, 0.16, PALETTE.wallLimestone, 1), {
          pos: [px, baseY + 2.8, pz],
        })
      );
    }
  }

  // --- 3. Molded Stone Belt Cornices (hollow ring bands around floor edges, never sealing stairwells!) ---
  for (let f = 1; f <= spec.floors; f++) {
    const cy = f === spec.floors ? baseY + wallH : baseY + groundH + (f - 1) * upperFloorH;
    const overhang = f === spec.floors ? 1.65 : 0.88;
    const thick = f === spec.floors ? 1.38 : 0.84;
    const bandW = 1.4;
    if (faces.north || faces.south) {
      for (const sz of [-1, 1] as const) {
        if ((sz > 0 && !faces.north) || (sz < 0 && !faces.south)) continue;
        parts.push(
          transformGeo(rbox(w + overhang, thick, bandW, 0.14, trim, 1), {
            pos: [cx, cy, cz + sz * (d * 0.5 + overhang * 0.5 - bandW * 0.5)],
          })
        );
      }
    }
    if (faces.east || faces.west) {
      for (const sx of [-1, 1] as const) {
        if ((sx > 0 && !faces.east) || (sx < 0 && !faces.west)) continue;
        parts.push(
          transformGeo(rbox(bandW, thick, d + overhang, 0.14, trim, 1), {
            pos: [cx + sx * (w * 0.5 + overhang * 0.5 - bandW * 0.5), cy, cz],
          })
        );
      }
    }
  }

  // --- 4. Vertical Corner Pilaster Strips + Story-Height Rusticated Accent Blocks ---
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const cornerVisible =
        (sx > 0 ? faces.east : faces.west) || (sz > 0 ? faces.north : faces.south);
      if (!cornerVisible) continue;
      const px = cx + sx * (w * 0.5 - 0.38);
      const pz = cz + sz * (d * 0.5 - 0.38);
      parts.push(
        transformGeo(rbox(1.18, wallH - 0.4, 1.18, 0.08, trim, 1), {
          pos: [px, baseY + wallH * 0.5, pz],
        })
      );
      for (let f = 0; f < spec.floors; f++) {
        const ay =
          f === 0 ? baseY + 12.6 : baseY + groundH + (f - 1) * upperFloorH + upperFloorH * 0.5;
        parts.push(
          transformGeo(rbox(1.52, 2.6, 1.52, 0.08, trim, 1), {
            pos: [px, ay, pz],
          })
        );
      }
    }
  }

  // --- 5. Facade Architectural Details: Open Double Doors, Open Shopfronts, Upper Windows & Shutters ---
  const addFacadeOpenings = (axis: 'x' | 'z', sign: -1 | 1, isFront: boolean): void => {
    const span = axis === 'x' ? d : w;
    const normalDist = (axis === 'x' ? w : d) * 0.5;
    const cols = Math.max(2, Math.floor((span - 4.4) / 9.8));
    const spacing = (span - 5.4) / Math.max(1, cols);
    const localDoorCol = Math.floor(cols * 0.5);

    for (let c = 0; c < cols; c++) {
      const offset = -((cols - 1) * spacing) * 0.5 + c * spacing;
      const isDoor = isFront && c === localDoorCol;
      const gx = axis === 'x' ? cx + sign * (normalDist + 0.08) : cx + offset;
      const gz = axis === 'z' ? cz + sign * (normalDist + 0.08) : cz + offset;
      const rotY =
        axis === 'x' ? (sign > 0 ? Math.PI * 0.5 : -Math.PI * 0.5) : sign > 0 ? 0 : Math.PI;
      const tangentX = Math.cos(rotY);
      const tangentZ = -Math.sin(rotY);
      const normalX = Math.sin(rotY);
      const normalZ = Math.cos(rotY);

      if (isDoor) {
        // Open Doorway Trim Surround (left jamb, right jamb, top architrave + glowing transom)
        parts.push(
          transformGeo(rbox(0.62, 16.4, 1.35, 0.1, trim, 1), {
            rot: [0, rotY, 0],
            pos: [gx - tangentX * 3.0, baseY + 8.2, gz - tangentZ * 3.0],
          }),
          transformGeo(rbox(0.62, 16.4, 1.35, 0.1, trim, 1), {
            rot: [0, rotY, 0],
            pos: [gx + tangentX * 3.0, baseY + 8.2, gz + tangentZ * 3.0],
          }),
          transformGeo(rbox(6.6, 0.95, 1.45, 0.12, trim, 1), {
            rot: [0, rotY, 0],
            pos: [gx, baseY + 16.5, gz],
          }),
          // Two swung-open walnut double doors folded cleanly outward flanking the open doorway
          transformGeo(rbox(2.3, 15.0, 0.28, 0.08, PALETTE.woodWalnut, 1), {
            rot: [0, rotY - 1.95, 0],
            pos: [
              gx - tangentX * 2.85 + normalX * 1.15,
              baseY + 7.6,
              gz - tangentZ * 2.85 + normalZ * 1.15,
            ],
          }),
          transformGeo(rbox(2.3, 15.0, 0.28, 0.08, PALETTE.woodWalnut, 1), {
            rot: [0, rotY + 1.95, 0],
            pos: [
              gx + tangentX * 2.85 + normalX * 1.15,
              baseY + 7.6,
              gz + tangentZ * 2.85 + normalZ * 1.15,
            ],
          })
        );
        // Warm glowing brass porch lantern right inside the open doorway arch
        glowTarget.push(
          transformGeo(rcyl(0.65, 0.65, 0.42, PALETTE.goldGlow, 12), {
            pos: [gx - normalX * 1.4, baseY + 14.9, gz - normalZ * 1.4],
          })
        );
      } else if (isFront) {
        // Open Shopfront Gallery Window Frame (hollow inside so street views & fly-ins are clear)
        parts.push(
          transformGeo(rbox(5.6, 0.62, 1.35, 0.08, trim, 1), {
            rot: [0, rotY, 0],
            pos: [gx, baseY + 4.65, gz],
          }),
          transformGeo(rbox(5.6, 0.65, 1.35, 0.08, trim, 1), {
            rot: [0, rotY, 0],
            pos: [gx, baseY + 17.7, gz],
          }),
          transformGeo(rbox(0.45, 13.0, 1.25, 0.06, trim, 1), {
            rot: [0, rotY, 0],
            pos: [gx - tangentX * 2.6, baseY + 11.2, gz - tangentZ * 2.6],
          }),
          transformGeo(rbox(0.45, 13.0, 1.25, 0.06, trim, 1), {
            rot: [0, rotY, 0],
            pos: [gx + tangentX * 2.6, baseY + 11.2, gz + tangentZ * 2.6],
          })
        );
      } else {
        // Side/rear decorative closed facade shopfront
        parts.push(
          transformGeo(rbox(6.0, 14.2, 0.5, 0.12, trim, 1), {
            rot: [0, rotY, 0],
            pos: [gx, baseY + 11.4, gz],
          }),
          transformGeo(rbox(4.9, 12.8, 0.6, 0.08, PALETTE.windowDeep, 1), {
            rot: [0, rotY, 0],
            pos: [gx, baseY + 11.4, gz],
          })
        );
      }
    }

    // Ground-floor striped storefront awning if specified
    if (isFront && spec.awningHex) {
      const awDepth = 5.6;
      const awW = Math.min(span - 3.0, cols * spacing + 3.4);
      const awY = baseY + 21.8;
      const awX = axis === 'x' ? cx + sign * (normalDist + awDepth * 0.5) : cx;
      const awZ = axis === 'z' ? cz + sign * (normalDist + awDepth * 0.5) : cz;
      const halfExt =
        axis === 'x'
          ? new THREE.Vector3(awDepth * 0.5, 0.58, awW * 0.5)
          : new THREE.Vector3(awW * 0.5, 0.58, awDepth * 0.5);
      ctx.createBouncyAwning(
        `${spec.id}_awning`,
        new THREE.Vector3(awX, awY, awZ),
        halfExt,
        spec.awningHex,
        PALETTE.awningCream,
        17.5
      );
    }

    // Upper-story French windows, shutters, flowerboxes & Juliet balconies
    for (let f = 1; f < spec.floors; f++) {
      const wy = baseY + groundH + (f - 1) * upperFloorH + 8.8;
      for (let c = 0; c < cols; c++) {
        const offset = -((cols - 1) * spacing) * 0.5 + c * spacing;
        const wx = axis === 'x' ? cx + sign * (normalDist + 0.08) : cx + offset;
        const wz = axis === 'z' ? cz + sign * (normalDist + 0.08) : cz + offset;
        const rotY =
          axis === 'x' ? (sign > 0 ? Math.PI * 0.5 : -Math.PI * 0.5) : sign > 0 ? 0 : Math.PI;
        const tangentX = Math.cos(rotY);
        const tangentZ = -Math.sin(rotY);
        const warmLit = (f + c) % 3 === 0;
        const glassCol = warmLit ? PALETTE.windowWarmLit : PALETTE.windowGlass;
        const isCenter = c === localDoorCol;

        const useInteractiveShutters = Boolean(
          spec.addPerches &&
            isFront &&
            f === 1 &&
            !warmLit &&
            !isCenter &&
            ctx.registerInteractiveWindow
        );
        const isOpenCutout = isFront && (isCenter || !useInteractiveShutters);
        const isWalkoutBalconyDoor = isFront && f === 1 && isCenter && hasWalkoutBalconyFloor1;

        // Open surround frame around cutout windows OR full recessed window pane on closed windows
        if (isOpenCutout) {
          parts.push(
            transformGeo(rbox(0.42, 11.4, 1.28, 0.08, trim, 1), {
              rot: [0, rotY, 0],
              pos: [wx - tangentX * 2.15, wy, wz - tangentZ * 2.15],
            }),
            transformGeo(rbox(0.42, 11.4, 1.28, 0.08, trim, 1), {
              rot: [0, rotY, 0],
              pos: [wx + tangentX * 2.15, wy, wz + tangentZ * 2.15],
            }),
            transformGeo(rbox(5.3, 0.52, 1.32, 0.08, trim, 1), {
              rot: [0, rotY, 0],
              pos: [wx, wy + 5.75, wz],
            })
          );
        } else {
          parts.push(
            transformGeo(rbox(4.8, 11.4, 0.44, 0.1, trim, 1), {
              rot: [0, rotY, 0],
              pos: [wx, wy, wz],
            }),
            transformGeo(rbox(5.3, 0.48, 0.72, 0.06, trim, 1), {
              rot: [0, rotY, 0],
              pos: [wx, wy + 5.85, wz],
            }),
            transformGeo(rbox(3.8, 10.2, 0.54, 0.06, glassCol, 1), {
              rot: [0, rotY, 0],
              pos: [wx, wy, wz],
            }),
            transformGeo(rbox(3.9, 0.24, 0.62, 0.04, trim, 1), {
              rot: [0, rotY, 0],
              pos: [wx, wy + 1.0, wz],
            }),
            transformGeo(rbox(3.9, 0.22, 0.62, 0.04, trim, 1), {
              rot: [0, rotY, 0],
              pos: [wx, wy - 2.2, wz],
            }),
            transformGeo(rbox(0.24, 10.2, 0.62, 0.04, trim, 1), {
              rot: [0, rotY, 0],
              pos: [wx, wy, wz],
            })
          );
        }

        // Paired louvered shutters (swung open outward on open front windows)
        if (!useInteractiveShutters) {
          for (const sSide of [-1, 1] as const) {
            const shOff = sSide * 2.75;
            const shX = axis === 'x' ? wx + sign * 0.16 : wx + shOff;
            const shZ = axis === 'z' ? wz + sign * 0.16 : wz + shOff;
            parts.push(
              transformGeo(rbox(1.45, 10.4, 0.3, 0.06, spec.shutterHex, 1), {
                rot: [0, rotY, 0],
                pos: [shX, wy, shZ],
              })
            );
          }
        }

        // Projecting windowsill + terracotta flowerbox OR Juliet balcony (skipped on walkout balcony door!)
        const sillOut = 0.78;
        const sxPos = axis === 'x' ? cx + sign * (normalDist + sillOut) : wx;
        const szPos = axis === 'z' ? cz + sign * (normalDist + sillOut) : wz;
        if (!isWalkoutBalconyDoor) {
          parts.push(
            transformGeo(rbox(5.2, 0.6, 1.45, 0.08, trim, 1), {
              rot: [0, rotY, 0],
              pos: [sxPos, wy - 5.8, szPos],
            })
          );
        }

        const isFlowerbox = !isCenter && (f + c) % 2 === 0;
        if (!isWalkoutBalconyDoor) {
          if (isFlowerbox) {
            const bloomHex = (f + c) % 4 === 0 ? PALETTE.tulipCoral : PALETTE.tulipYellow;
            parts.push(
              transformGeo(rbox(4.2, 1.15, 1.12, 0.1, PALETTE.brickTerracotta, 1), {
                rot: [0, rotY, 0],
                pos: [sxPos, wy - 4.95, szPos],
              }),
              transformGeo(rbox(3.8, 0.72, 0.88, 0.18, PALETTE.leafSage, 1), {
                rot: [0, rotY, 0],
                pos: [
                  axis === 'x' ? sxPos - sign * 0.08 : sxPos,
                  wy - 4.2,
                  axis === 'z' ? szPos - sign * 0.08 : szPos,
                ],
              })
            );
            for (const bOff of [-1.2, 0, 1.2]) {
              const bx = axis === 'x' ? sxPos - sign * 0.08 : sxPos + bOff;
              const bz = axis === 'z' ? szPos - sign * 0.08 : szPos + bOff;
              parts.push(
                transformGeo(rcyl(0.24, 0.12, 0.42, bloomHex, 6), {
                  pos: [bx, wy - 3.75, bz],
                })
              );
            }
          } else {
            parts.push(
              transformGeo(rbox(4.8, 2.5, 0.24, 0.05, PALETTE.ironworkPlum, 1), {
                rot: [0, rotY, 0],
                pos: [
                  axis === 'x' ? sxPos + sign * 0.48 : sxPos,
                  wy - 4.25,
                  axis === 'z' ? szPos + sign * 0.48 : szPos,
                ],
              })
            );
          }
        }

        if (spec.addPerches && !isWalkoutBalconyDoor) {
          const faceTag = `${axis}${sign > 0 ? 'p' : 'n'}`;
          const perchY = isFlowerbox ? wy - 4.38 : wy - 2.98;
          const outOff = isFlowerbox ? 0.5 : 0.48;
          const halfSpan = isFlowerbox ? 1.85 : 2.15;
          const pA =
            axis === 'x'
              ? new THREE.Vector3(sxPos + sign * outOff, perchY, szPos - halfSpan)
              : new THREE.Vector3(sxPos - halfSpan, perchY, szPos + sign * outOff);
          const pB =
            axis === 'x'
              ? new THREE.Vector3(sxPos + sign * outOff, perchY, szPos + halfSpan)
              : new THREE.Vector3(sxPos + halfSpan, perchY, szPos + sign * outOff);
          const sillSeg = ctx.perches.addStaticSegment(
            `${spec.id}_${faceTag}_sill_${f}_${c}`,
            pA,
            pB,
            isFlowerbox ? 0.04 : 0.09,
            isFlowerbox ? 'stone' : 'metal'
          );
          if (isFlowerbox) {
            ctx.onFlowerboxSillCreated?.(sillSeg, new THREE.Vector3(sxPos, wy - 3.9, szPos));
          }
          if (useInteractiveShutters) {
            ctx.registerInteractiveWindow?.({
              id: `${spec.id}_${faceTag}_win_${f}_${c}`,
              wx,
              wy,
              wz,
              rotY,
              axis,
              sign,
              shutterHex: spec.shutterHex,
              isFlowerbox,
              sillPerch: sillSeg,
            });
          }
        }
      }
    }
  };

  if (faces.east) addFacadeOpenings('x', 1, spec.frontFace === 'east');
  if (faces.west) addFacadeOpenings('x', -1, spec.frontFace === 'west');
  if (faces.north) addFacadeOpenings('z', 1, spec.frontFace === 'north');
  if (faces.south) addFacadeOpenings('z', -1, spec.frontFace === 'south');

  // --- 6. Populate Multi-Story Hollow Interiors, Stairwells, Beams & Chandeliers ---
  populateTownhouseInterior({
    id: spec.id,
    cx,
    cz,
    innerXMin,
    innerXMax,
    innerZMin,
    innerZMax,
    baseY,
    groundH,
    upperFloorH,
    floors: spec.floors,
    frontFace: spec.frontFace,
    wallHex: spec.wallHex,
    shutterHex: spec.shutterHex,
    isPerimeter,
    parts,
    glowParts: glowTarget,
    physics: ctx.physics,
    perches: ctx.perches,
    avoidRect: spec.avoidInteriorRect,
  });

  // --- 7. Steep Pitched Parisian Mansard Slate Roof OR Mediterranean Terracotta Hip Roof + Dormers + Chimneys ---
  const roofBaseY = baseY + wallH + 0.55;
  const isMansard = spec.roofStyle === 'mansard';
  const roofH = isMansard ? 13.4 : 10.6;
  const roofHex = isMansard ? PALETTE.roofSlate : PALETTE.roofTerracotta;
  const topRatio = isMansard ? 0.72 : 0.34;

  parts.push(
    transformGeo(buildPitchedHipRoofGeo(w + 1.1, d + 1.1, roofH, topRatio, roofHex), {
      pos: [cx, roofBaseY + roofH * 0.5, cz],
    }),
    transformGeo(
      rbox(w * topRatio + 0.45, 0.65, d * topRatio + 0.45, 0.12, PALETTE.roofCopperPatina, 1),
      { pos: [cx, roofBaseY + roofH + 0.18, cz] }
    )
  );

  // Solid roof/attic collider ABOVE `wallH` (never blocking interior rooms below `wallH`)
  const roofColBottom = baseY + wallH;
  const roofColTop = Math.max(baseY + naturalColH, isPerimeter ? spec.minColliderTopY! : baseY + naturalColH);
  const roofColH = Math.max(2.0, roofColTop - roofColBottom);
  const roofCol = ctx.physics.addStaticBox(
    new THREE.Vector3(cx, roofColBottom + roofColH * 0.5, cz),
    new THREE.Vector3(w * 0.5, roofColH * 0.5, d * 0.5)
  );
  ctx.physics.setBumpMetadata(roofCol, { surface: 'stone', causesDizzy: true });

  if (isMansard) {
    const cw = w * topRatio;
    const cd = d * topRatio;
    parts.push(
      transformGeo(rbox(cw, 1.35, 0.2, 0.04, PALETTE.ironworkPlum, 1), {
        pos: [cx, roofBaseY + roofH + 1.05, cz + cd * 0.48],
      }),
      transformGeo(rbox(cw, 1.35, 0.2, 0.04, PALETTE.ironworkPlum, 1), {
        pos: [cx, roofBaseY + roofH + 1.05, cz - cd * 0.48],
      }),
      transformGeo(rbox(0.2, 1.35, cd, 0.04, PALETTE.ironworkPlum, 1), {
        pos: [cx + cw * 0.48, roofBaseY + roofH + 1.05, cz],
      }),
      transformGeo(rbox(0.2, 1.35, cd, 0.04, PALETTE.ironworkPlum, 1), {
        pos: [cx - cw * 0.48, roofBaseY + roofH + 1.05, cz],
      })
    );

    if (spec.addPerches) {
      const mansardRailY = roofBaseY + roofH + 1.725;
      const hw = cw * 0.46;
      const hd = cd * 0.46;
      ctx.perches.addStaticSegment(
        `${spec.id}_mansard_rail_n`,
        new THREE.Vector3(cx - hw, mansardRailY, cz + cd * 0.48),
        new THREE.Vector3(cx + hw, mansardRailY, cz + cd * 0.48),
        0.08,
        'metal'
      );
      ctx.perches.addStaticSegment(
        `${spec.id}_mansard_rail_s`,
        new THREE.Vector3(cx - hw, mansardRailY, cz - cd * 0.48),
        new THREE.Vector3(cx + hw, mansardRailY, cz - cd * 0.48),
        0.08,
        'metal'
      );
      ctx.perches.addStaticSegment(
        `${spec.id}_mansard_rail_e`,
        new THREE.Vector3(cx + cw * 0.48, mansardRailY, cz - hd),
        new THREE.Vector3(cx + cw * 0.48, mansardRailY, cz + hd),
        0.08,
        'metal'
      );
      ctx.perches.addStaticSegment(
        `${spec.id}_mansard_rail_w`,
        new THREE.Vector3(cx - cw * 0.48, mansardRailY, cz - hd),
        new THREE.Vector3(cx - cw * 0.48, mansardRailY, cz + hd),
        0.08,
        'metal'
      );
    }

    const addRoofDormers = (axis: 'x' | 'z', sign: -1 | 1): void => {
      const span = axis === 'x' ? d : w;
      const slopeDist = (axis === 'x' ? w : d) * 0.44;
      const dCount = Math.max(1, Math.floor((span - 8.0) / 11.5));
      const dSpacing = (span - 9.0) / Math.max(1, dCount);
      const rotY =
        axis === 'x' ? (sign > 0 ? Math.PI * 0.5 : -Math.PI * 0.5) : sign > 0 ? 0 : Math.PI;
      for (let k = 0; k < dCount; k++) {
        const off = dCount === 1 ? 0 : -((dCount - 1) * dSpacing) * 0.5 + k * dSpacing;
        const dx = axis === 'x' ? cx + sign * slopeDist : cx + off;
        const dz = axis === 'z' ? cz + sign * slopeDist : cz + off;
        const dy = roofBaseY + 4.8;
        parts.push(
          transformGeo(rbox(3.5, 5.8, 3.2, 0.1, trim, 1), {
            rot: [0, rotY, 0],
            pos: [dx, dy, dz],
          }),
          transformGeo(rbox(2.4, 4.4, 0.48, 0.05, PALETTE.windowGlass, 1), {
            rot: [0, rotY, 0],
            pos: [
              axis === 'x' ? dx + sign * 1.42 : dx,
              dy - 0.1,
              axis === 'z' ? dz + sign * 1.42 : dz,
            ],
          }),
          transformGeo(buildPitchedHipRoofGeo(4.0, 3.7, 1.95, 0.18, PALETTE.roofCopperPatina), {
            pos: [dx, dy + 3.8, dz],
          })
        );
      }
    };

    if (faces.east) addRoofDormers('x', 1);
    if (faces.west) addRoofDormers('x', -1);
    if (faces.north) addRoofDormers('z', 1);
    if (faces.south) addRoofDormers('z', -1);
  }

  // Brick chimneys with terracotta chimney pots
  for (const side of [-1, 1] as const) {
    const chX = cx + side * (w * 0.28);
    const chZ = cz - d * 0.18;
    parts.push(
      transformGeo(rbox(2.8, 6.4, 2.8, 0.14, PALETTE.brickTerracotta, 1), {
        pos: [chX, roofBaseY + roofH + 1.8, chZ],
      }),
      transformGeo(rbox(3.3, 0.58, 3.3, 0.08, trim, 1), {
        pos: [chX, roofBaseY + roofH + 5.0, chZ],
      }),
      transformGeo(rcyl(0.46, 0.54, 1.65, PALETTE.roofTerracotta, 8), {
        pos: [chX - 0.58, roofBaseY + roofH + 6.0, chZ],
      }),
      transformGeo(rcyl(0.46, 0.54, 1.65, PALETTE.roofTerracotta, 8), {
        pos: [chX + 0.58, roofBaseY + roofH + 6.0, chZ],
      })
    );
  }

  let houseMesh: THREE.Mesh | null = null;
  if (collectInto) {
    for (let i = 0; i < parts.length; i++) {
      collectInto.push(parts[i]);
    }
  } else {
    houseMesh = new THREE.Mesh(mergeParts(parts), ctx.mat);
    houseMesh.castShadow = true;
    houseMesh.receiveShadow = true;
    houseMesh.geometry.computeBoundingSphere();
    ctx.root.add(houseMesh);
  }

  if (!glowCollectInto && localGlowParts.length > 0) {
    // Standalone fallback mesh if caller didn't supply a shared glowParts collector
    const gMesh = new THREE.Mesh(mergeParts(localGlowParts), ctx.mat);
    gMesh.geometry.computeBoundingSphere();
    ctx.root.add(gMesh);
  }

  if (spec.addPerches) {
    const eaveY = baseY + wallH + 0.69;
    if (faces.east) {
      const ex = cx + w * 0.5 + 0.62;
      ctx.perches.addStaticSegment(
        `${spec.id}_roof_eave_e`,
        new THREE.Vector3(ex, eaveY, cz - d * 0.45),
        new THREE.Vector3(ex, eaveY, cz + d * 0.45),
        0.03,
        'stone'
      );
    }
    if (faces.west) {
      const ex = cx - w * 0.5 - 0.62;
      ctx.perches.addStaticSegment(
        `${spec.id}_roof_eave_w`,
        new THREE.Vector3(ex, eaveY, cz - d * 0.45),
        new THREE.Vector3(ex, eaveY, cz + d * 0.45),
        0.03,
        'stone'
      );
    }
    if (faces.north) {
      const ez = cz + d * 0.5 + 0.62;
      ctx.perches.addStaticSegment(
        `${spec.id}_roof_eave_n`,
        new THREE.Vector3(cx - w * 0.45, eaveY, ez),
        new THREE.Vector3(cx + w * 0.45, eaveY, ez),
        0.03,
        'stone'
      );
    }
    if (faces.south) {
      const ez = cz - d * 0.5 - 0.62;
      ctx.perches.addStaticSegment(
        `${spec.id}_roof_eave_s`,
        new THREE.Vector3(cx - w * 0.45, eaveY, ez),
        new THREE.Vector3(cx + w * 0.45, eaveY, ez),
        0.03,
        'stone'
      );
    }
  }

  return houseMesh;
}
