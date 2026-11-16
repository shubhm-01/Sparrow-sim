import type * as THREE from 'three/webgpu';

export interface BuildingInteriorVolume {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
}

const buildingInteriors: BuildingInteriorVolume[] = [];

export function clearBuildingInteriors(): void {
  buildingInteriors.length = 0;
}

export function registerBuildingInterior(vol: BuildingInteriorVolume): void {
  buildingInteriors.push(vol);
}

/** True when `pos` is inside the attic Conservatory Atelier interior volume. */
export function isInsideAtelier(pos: THREE.Vector3): boolean {
  return (
    pos.x >= -86.6 &&
    pos.x <= -39.4 &&
    pos.y >= 26.2 &&
    pos.y <= 51.6 &&
    pos.z >= 25.4 &&
    pos.z <= 78.6
  );
}

/** True when `pos` is inside the Conservatory Atelier or any enterable house/building interior. */
export function isInsideAnyBuilding(pos: THREE.Vector3): boolean {
  if (isInsideAtelier(pos)) return true;
  const x = pos.x;
  const y = pos.y;
  const z = pos.z;
  for (let i = 0; i < buildingInteriors.length; i++) {
    const b = buildingInteriors[i];
    if (
      x >= b.xMin &&
      x <= b.xMax &&
      y >= b.yMin &&
      y <= b.yMax &&
      z >= b.zMin &&
      z <= b.zMax
    ) {
      return true;
    }
  }
  return false;
}
