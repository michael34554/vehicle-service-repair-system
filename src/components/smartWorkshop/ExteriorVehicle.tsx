import { useEffect, useMemo } from 'react';
import { useGLTF, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import type { ComponentKey, ComponentStatus } from '@/shared/smartWorkshop';
import { DRACO_PATH, STATUS_COLORS, type ViewStyle } from './viewerConfig';

interface Props {
  statuses: Record<ComponentKey, ComponentStatus>;
  selected: ComponentKey | null;
  style: ViewStyle;
  onSelect: (key: ComponentKey) => void;
  modelPath: string;
  nodeMap?: Record<string, ComponentKey>;
  shadowPath?: string | null;
  interactive?: boolean;
  focusSelected?: boolean;
}

type EmissiveMaterial = THREE.Material & { emissive: THREE.Color; emissiveIntensity: number };

function hasEmissive(material: THREE.Material): material is EmissiveMaterial {
  return 'emissive' in material && material.emissive instanceof THREE.Color && 'emissiveIntensity' in material;
}

function componentFromObject(object: THREE.Object3D | null, nodeMap: Record<string, ComponentKey>): ComponentKey | null {
  let current = object;
  while (current) {
    const match = nodeMap[current.name];
    if (match) return match;
    current = current.parent;
  }
  return null;
}

function GroundShadow({ path }: { path: string }) {
  const shadow = useTexture(path);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} renderOrder={2}>
      <planeGeometry args={[2.62, 5.2]} />
      <meshBasicMaterial map={shadow} transparent blending={THREE.MultiplyBlending} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** Renders the selected asset's GLB. Only nodes present in that asset's verified node map are selectable. */
export function ExteriorVehicle({
  statuses, selected, style, onSelect, modelPath, nodeMap, shadowPath = null,
  interactive = true, focusSelected = false,
}: Props) {
  const { scene } = useGLTF(modelPath, DRACO_PATH);
  const resolvedNodeMap = useMemo(() => ({ ...(nodeMap ?? {}) }), [nodeMap]);
  const model = useMemo(() => scene.clone(true), [scene]);

  const materials = useMemo(() => {
    const map = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    model.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;
      const mesh = object as THREE.Mesh;
      const cloneMaterial = (material: THREE.Material): THREE.Material => {
        const copy = material.clone();
        copy.transparent = false;
        copy.opacity = 1;
        copy.depthWrite = true;
        if (hasEmissive(copy)) {
          copy.emissive.set('#000000');
          copy.emissiveIntensity = 0;
        }
        return copy;
      };
      const cloned = Array.isArray(mesh.material)
        ? mesh.material.map(cloneMaterial)
        : cloneMaterial(mesh.material);
      mesh.material = cloned;
      map.set(mesh, cloned);
    });
    return map;
  }, [model]);

  useEffect(() => () => {
    materials.forEach((entry) => {
      if (Array.isArray(entry)) entry.forEach((material) => material.dispose());
      else entry.dispose();
    });
  }, [materials]);

  useEffect(() => {
    materials.forEach((entry, mesh) => {
      const component = componentFromObject(mesh, resolvedNodeMap);
      const status = component ? statuses[component]?.status ?? 'grey' : null;
      const isSelected = component !== null && selected === component;
      const dimmed = focusSelected && selected !== null && !isSelected;
      const emissiveColor = status ? STATUS_COLORS[status] : '#000000';
      const intensity = dimmed ? 0 : isSelected ? 0.9 : status === 'red' ? 0.7 : status === 'orange' ? 0.45 : 0;
      const list = Array.isArray(entry) ? entry : [entry];
      list.forEach((material) => {
        material.transparent = style === 'transparent';
        material.opacity = style === 'transparent' ? (dimmed ? 0.12 : 0.28) : 1;
        material.depthWrite = style !== 'transparent';
        if (hasEmissive(material)) {
          material.emissive.set(emissiveColor);
          material.emissiveIntensity = intensity;
        }
      });
    });
  }, [materials, statuses, selected, style, focusSelected, resolvedNodeMap]);

  const handleClick = (event: { object: THREE.Object3D; stopPropagation: () => void }) => {
    const component = componentFromObject(event.object, resolvedNodeMap);
    if (!component) return;
    event.stopPropagation();
    onSelect(component);
  };

  return (
    <group>
      <primitive
        object={model}
        onClick={interactive ? handleClick : undefined}
        onPointerOver={interactive ? (event: { object: THREE.Object3D; stopPropagation: () => void }) => {
          if (!componentFromObject(event.object, resolvedNodeMap)) return;
          event.stopPropagation();
          document.body.style.cursor = 'pointer';
        } : undefined}
        onPointerOut={interactive ? () => { document.body.style.cursor = ''; } : undefined}
      />
      {shadowPath && <GroundShadow path={shadowPath} />}
    </group>
  );
}
