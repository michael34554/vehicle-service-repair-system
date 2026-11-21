import { createContext, memo, useContext, useMemo, type ReactNode } from 'react';
import type { ComponentKey, ComponentStatus } from '@/shared/smartWorkshop';
import type { ThreeEvent } from '@react-three/fiber';
import type { ViewStyle } from './viewerConfig';
import { STATUS_COLORS } from './viewerConfig';

interface Props {
  statuses: Record<ComponentKey, ComponentStatus>;
  selected: ComponentKey | null;
  style: ViewStyle;
  onSelect: (key: ComponentKey) => void;
  focusSelected?: boolean;
}

type Args = [number, number, number] | [number, number, number, number];
type Geometry = 'box' | 'cylinder' | 'torus' | 'sphere';

interface MeshProps {
  component: ComponentKey;
  geometry: Geometry;
  args: Args;
  position: [number, number, number];
  rotation?: [number, number, number];
  baseColor: string;
  metalness?: number;
}

const BASE_COLORS: Record<ComponentKey, string> = {
  engine: '#64748b',
  transmission: '#475569',
  fuel_system: '#b45309',
  cooling_system: '#0e7490',
  thermostat: '#0891b2',
  water_pump: '#155e75',
  radiator: '#52606d',
  brakes: '#94a3b8',
  front_suspension: '#7c8493',
  rear_suspension: '#7c8493',
  steering: '#a16207',
  battery: '#1d4ed8',
  alternator: '#4338ca',
  electrical_system: '#a16207',
  exhaust: '#8a6d3b',
  air_conditioning: '#0d9488',
  wheels_tyres: '#1e293b',
};

const EXPLODE_OFFSETS: Record<ComponentKey, [number, number, number]> = {
  engine: [0, 0.75, -0.25],
  transmission: [0, -0.12, 1.05],
  fuel_system: [-0.8, 0.45, 0.65],
  cooling_system: [0.85, 0.35, -0.75],
  thermostat: [-0.45, 0.75, -1.05],
  water_pump: [0.7, 0.65, -1.05],
  radiator: [0, 0.15, -1.15],
  brakes: [0, -0.45, 0],
  front_suspension: [0, 0.45, -0.65],
  rear_suspension: [0, 0.45, 0.7],
  steering: [-0.65, 0.6, -0.15],
  battery: [-0.9, 0.6, -0.45],
  alternator: [0.9, 0.7, -0.45],
  electrical_system: [-1.05, 0.85, 0.3],
  exhaust: [0.7, -0.3, 0.4],
  air_conditioning: [0.95, 0.6, -0.95],
  wheels_tyres: [0, -0.6, 0],
};

interface PartStyle {
  color: string;
  intensity: number;
}

const PartStyleContext = createContext<PartStyle>({ color: '#94a3b8', intensity: 0.03 });

function PartMesh({ component, geometry, args, position, rotation, baseColor, metalness = 0.65 }: MeshProps) {
  const partStyle = useContext(PartStyleContext);
  void component;
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      {geometry === 'box' && <boxGeometry args={args as [number, number, number]} />}
      {geometry === 'cylinder' && <cylinderGeometry args={args as [number, number, number, number]} />}
      {geometry === 'torus' && <torusGeometry args={args as [number, number, number, number]} />}
      {geometry === 'sphere' && <sphereGeometry args={args as [number, number, number]} />}
      <meshStandardMaterial
        color={baseColor}
        metalness={metalness}
        roughness={0.42}
        emissive={partStyle.color}
        emissiveIntensity={partStyle.intensity}
      />
    </mesh>
  );
}

interface PartGroupProps {
  component: ComponentKey;
  statuses: Record<ComponentKey, ComponentStatus>;
  selected: ComponentKey | null;
  style: ViewStyle;
  onSelect: (key: ComponentKey) => void;
  focusSelected?: boolean;
  children: ReactNode;
}

/** A group is a single selectable mechanical component. Status drives its emissive colour. */
const PartGroup = memo(function PartGroup({ component, statuses, selected, style, onSelect, focusSelected = false, children }: PartGroupProps) {
  const offset = useMemo(() => EXPLODE_OFFSETS[component], [component]);
  const status = statuses[component]?.status ?? 'grey';
  const isSelected = selected === component;
  const color = STATUS_COLORS[status];
  const dimmed = focusSelected && selected !== null && !isSelected;
  const intensity = dimmed ? 0 : status === 'red' ? 0.9 : status === 'orange' ? 0.6 : isSelected ? 0.75 : status === 'green' ? 0.22 : 0.03;
  const position: [number, number, number] = style === 'exploded'
    ? [offset[0], offset[1], offset[2]]
    : [0, 0, 0];

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(component);
  };

  return (
    <PartStyleContext.Provider value={{ color, intensity }}>
      <group
        position={position}
        onClick={handleClick}
        onPointerOver={(event) => { event.stopPropagation(); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { document.body.style.cursor = ''; }}
      >
        {children}
      </group>
    </PartStyleContext.Provider>
  );
});

/**
 * Procedural 3D mechanical assembly used by the internal inspection mode.
 * These are real Three.js meshes, not images; each group maps to one component key.
 */
export const MechanicalAssembly = memo(function MechanicalAssembly({ statuses, selected, style, onSelect, focusSelected = false }: Props) {
  const wheelPositions: [number, number, number][] = [
    [-0.843, 0.358, -1.155],
    [0.829, 0.358, -1.154],
    [-0.821, 0.358, 1.495],
    [0.824, 0.358, 1.496],
  ];
  const common = { statuses, selected, style, onSelect, focusSelected };
  const detailColor = '#334155';

  return (
    <group>
      <PartGroup component="engine" {...common}>
        <PartMesh component="engine" geometry="box" args={[0.92, 0.52, 0.82]} position={[0, 0.74, -0.35]} baseColor={BASE_COLORS.engine} />
        <PartMesh component="engine" geometry="box" args={[0.7, 0.08, 0.62]} position={[0, 1.02, -0.35]} baseColor={detailColor} />
        {[-0.26, 0.26].flatMap((x) => [-0.56, -0.15].map((z) => (
          <PartMesh key={`coil-${x}-${z}`} component="engine" geometry="cylinder" args={[0.065, 0.065, 0.2, 10]} position={[x, 1.14, z]} baseColor="#cbd5e1" />
        )))}
      </PartGroup>

      <PartGroup component="transmission" {...common}>
        <PartMesh component="transmission" geometry="box" args={[0.52, 0.4, 0.72]} position={[0, 0.52, 0.42]} baseColor={BASE_COLORS.transmission} />
        <PartMesh component="transmission" geometry="cylinder" args={[0.11, 0.11, 0.68, 12]} position={[0, 0.52, 0.9]} rotation={[Math.PI / 2, 0, 0]} baseColor="#94a3b8" />
      </PartGroup>

      <PartGroup component="fuel_system" {...common}>
        <PartMesh component="fuel_system" geometry="box" args={[0.34, 0.22, 0.46]} position={[-0.55, 0.38, 1.1]} baseColor={BASE_COLORS.fuel_system} />
        <PartMesh component="fuel_system" geometry="cylinder" args={[0.035, 0.035, 1.25, 10]} position={[-0.36, 0.46, 0.35]} rotation={[Math.PI / 2, 0, 0]} baseColor="#d97706" />
        <PartMesh component="fuel_system" geometry="box" args={[0.26, 0.16, 0.32]} position={[0.34, 0.84, -0.72]} baseColor="#92400e" />
      </PartGroup>

      <PartGroup component="battery" {...common}>
        <PartMesh component="battery" geometry="box" args={[0.36, 0.26, 0.42]} position={[-0.62, 0.64, -1.02]} baseColor={BASE_COLORS.battery} />
        <PartMesh component="battery" geometry="cylinder" args={[0.035, 0.035, 0.07, 10]} position={[-0.7, 0.8, -1.08]} baseColor="#ef4444" />
        <PartMesh component="battery" geometry="cylinder" args={[0.035, 0.035, 0.07, 10]} position={[-0.54, 0.8, -1.08]} baseColor="#22c55e" />
      </PartGroup>

      <PartGroup component="alternator" {...common}>
        <PartMesh component="alternator" geometry="cylinder" args={[0.14, 0.14, 0.26, 18]} position={[0.68, 0.76, -0.62]} rotation={[0, 0, Math.PI / 2]} baseColor={BASE_COLORS.alternator} />
        <PartMesh component="alternator" geometry="cylinder" args={[0.08, 0.08, 0.06, 14]} position={[0.84, 0.76, -0.62]} rotation={[0, 0, Math.PI / 2]} baseColor="#a5b4fc" />
      </PartGroup>

      <PartGroup component="electrical_system" {...common}>
        <PartMesh component="electrical_system" geometry="box" args={[0.3, 0.24, 0.18]} position={[-0.62, 0.88, -0.42]} baseColor={BASE_COLORS.electrical_system} />
        <PartMesh component="electrical_system" geometry="cylinder" args={[0.018, 0.018, 0.9, 8]} position={[-0.48, 0.9, -0.1]} rotation={[Math.PI / 2, 0, 0]} baseColor="#ca8a04" />
        <PartMesh component="electrical_system" geometry="box" args={[0.22, 0.16, 0.12]} position={[0.58, 0.88, -0.35]} baseColor="#78350f" />
      </PartGroup>

      <PartGroup component="radiator" {...common}>
        <PartMesh component="radiator" geometry="box" args={[1.28, 0.52, 0.1]} position={[0, 0.62, -1.72]} baseColor={BASE_COLORS.radiator} />
        {[0.5, 0.62, 0.74].map((x) => (
          <PartMesh key={`rad-${x}`} component="radiator" geometry="box" args={[0.03, 0.5, 0.14]} position={[x, 0.62, -1.72]} baseColor="#94a3b8" />
        ))}
      </PartGroup>

      <PartGroup component="cooling_system" {...common}>
        <PartMesh component="cooling_system" geometry="cylinder" args={[0.17, 0.17, 0.18, 16]} position={[0.5, 0.56, -1.34]} rotation={[Math.PI / 2, 0, 0]} baseColor={BASE_COLORS.cooling_system} />
        <PartMesh component="cooling_system" geometry="torus" args={[0.28, 0.035, 10, 24]} position={[0, 0.62, -1.6]} baseColor="#0ea5e9" />
        <PartMesh component="cooling_system" geometry="cylinder" args={[0.055, 0.055, 1.05, 10]} position={[0.45, 0.72, -0.85]} rotation={[Math.PI / 2, 0, 0]} baseColor="#0891b2" />
        <PartMesh component="cooling_system" geometry="box" args={[0.16, 0.13, 0.16]} position={[-0.35, 0.93, -0.55]} baseColor="#e2e8f0" />
      </PartGroup>

      <PartGroup component="thermostat" {...common}>
        <PartMesh component="thermostat" geometry="cylinder" args={[0.12, 0.12, 0.14, 16]} position={[-0.3, 0.86, -1.35]} baseColor={BASE_COLORS.thermostat} />
        <PartMesh component="thermostat" geometry="cylinder" args={[0.06, 0.06, 0.22, 12]} position={[-0.3, 0.86, -1.35]} baseColor="#67e8f9" />
      </PartGroup>

      <PartGroup component="water_pump" {...common}>
        <PartMesh component="water_pump" geometry="cylinder" args={[0.15, 0.15, 0.16, 18]} position={[0.44, 0.62, -1.24]} baseColor={BASE_COLORS.water_pump} />
        <PartMesh component="water_pump" geometry="torus" args={[0.12, 0.02, 8, 18]} position={[0.44, 0.62, -1.14]} baseColor="#22d3ee" />
      </PartGroup>

      <PartGroup component="brakes" {...common}>
        {wheelPositions.map(([x, y, z], index) => (
          <PartMesh key={`brake-${index}`} component="brakes" geometry="cylinder" args={[0.22, 0.22, 0.045, 20]} position={[x, y, z]} rotation={[0, 0, Math.PI / 2]} baseColor={BASE_COLORS.brakes} />
        ))}
      </PartGroup>

      <PartGroup component="front_suspension" {...common}>
        {[-0.7, 0.7].map((x) => (
          <PartMesh key={`fs-${x}`} component="front_suspension" geometry="cylinder" args={[0.07, 0.07, 0.62, 10]} position={[x, 0.66, -1.16]} baseColor={BASE_COLORS.front_suspension} />
        ))}
        <PartMesh component="front_suspension" geometry="cylinder" args={[0.045, 0.045, 1.5, 10]} position={[0, 0.42, -1.16]} rotation={[0, 0, Math.PI / 2]} baseColor="#94a3b8" />
      </PartGroup>

      <PartGroup component="rear_suspension" {...common}>
        {[-0.7, 0.7].map((x) => (
          <PartMesh key={`rs-${x}`} component="rear_suspension" geometry="cylinder" args={[0.07, 0.07, 0.6, 10]} position={[x, 0.64, 1.5]} baseColor={BASE_COLORS.rear_suspension} />
        ))}
        <PartMesh component="rear_suspension" geometry="cylinder" args={[0.045, 0.045, 1.5, 10]} position={[0, 0.4, 1.5]} rotation={[0, 0, Math.PI / 2]} baseColor="#94a3b8" />
      </PartGroup>

      <PartGroup component="steering" {...common}>
        <PartMesh component="steering" geometry="cylinder" args={[0.05, 0.05, 1.35, 12]} position={[0, 0.42, -1.05]} rotation={[0, 0, Math.PI / 2]} baseColor={BASE_COLORS.steering} />
        <PartMesh component="steering" geometry="cylinder" args={[0.035, 0.035, 0.6, 10]} position={[-0.2, 0.62, -0.68]} rotation={[0.7, 0, -0.4]} baseColor="#a16207" />
        <PartMesh component="steering" geometry="torus" args={[0.18, 0.035, 12, 28]} position={[-0.35, 0.87, -0.45]} rotation={[0.5, 0, -0.5]} baseColor="#1e293b" />
      </PartGroup>

      <PartGroup component="wheels_tyres" {...common}>
        {wheelPositions.map(([x, y, z], index) => (
          <group key={`wheel-${index}`}>
            <PartMesh component="wheels_tyres" geometry="torus" args={[0.28, 0.105, 12, 28]} position={[x, y, z]} rotation={[0, Math.PI / 2, 0]} baseColor={BASE_COLORS.wheels_tyres} metalness={0.1} />
            <PartMesh component="wheels_tyres" geometry="cylinder" args={[0.2, 0.2, 0.09, 20]} position={[x, y, z]} rotation={[0, 0, Math.PI / 2]} baseColor="#cbd5e1" />
          </group>
        ))}
      </PartGroup>

      <PartGroup component="exhaust" {...common}>
        <PartMesh component="exhaust" geometry="cylinder" args={[0.055, 0.055, 3.0, 12]} position={[0.32, 0.27, 0]} rotation={[Math.PI / 2, 0, 0]} baseColor={BASE_COLORS.exhaust} />
        <PartMesh component="exhaust" geometry="cylinder" args={[0.13, 0.13, 0.32, 14]} position={[0.32, 0.27, -0.4]} rotation={[Math.PI / 2, 0, 0]} baseColor="#b45309" />
        <PartMesh component="exhaust" geometry="box" args={[0.42, 0.24, 0.52]} position={[0.32, 0.27, 1.35]} baseColor="#92400e" />
      </PartGroup>

      <PartGroup component="air_conditioning" {...common}>
        <PartMesh component="air_conditioning" geometry="cylinder" args={[0.13, 0.13, 0.3, 16]} position={[0.7, 0.82, -0.95]} rotation={[0, 0, Math.PI / 2]} baseColor={BASE_COLORS.air_conditioning} />
        <PartMesh component="air_conditioning" geometry="box" args={[0.7, 0.36, 0.1]} position={[0, 0.82, -1.5]} baseColor="#5eead4" />
        <PartMesh component="air_conditioning" geometry="box" args={[0.5, 0.16, 0.28]} position={[0, 0.92, -0.35]} baseColor="#134e4a" />
      </PartGroup>
    </group>
  );
});
