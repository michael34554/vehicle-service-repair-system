/**
 * Shared, browser-safe domain rules for the NEXTGEN AI Smart Workshop.
 * Imported by the Express server and the React viewer so that a component's
 * status is derived identically for the API, the 3D scene and the info panel.
 */

export type ComponentKey =
  | 'engine'
  | 'transmission'
  | 'battery'
  | 'radiator'
  | 'cooling_system'
  | 'brakes'
  | 'front_suspension'
  | 'rear_suspension'
  | 'steering'
  | 'wheels_tyres'
  | 'exhaust';

export type WorkshopStatus = 'green' | 'orange' | 'red' | 'grey';
export type InspectionCondition = 'no_fault_found' | 'inspection_recommended' | 'possible_fault' | 'fault_confirmed';

export interface SmartWorkshopComponent {
  key: ComponentKey;
  label: string;
  description: string;
  exteriorNodes: string[];
  inspectionFocus: string[];
}

/**
 * Authoritative component and fault mapping. `smart_workshop_config.json` is a
 * documentation snapshot of this object; this module is imported by the server
 * and the browser so both use one source of truth.
 */
export const SMART_WORKSHOP_CONFIG: SmartWorkshopConfig = {
  version: 'smart-workshop-components-v1',
  components: [
    { key: 'engine', label: 'Engine', description: 'Engine assembly, ignition, fuel trimming and ancillary drive.', exteriorNodes: [], inspectionFocus: ['Check engine light and stored codes', 'Idle quality and fuel trims', 'Spark plugs and ignition coils', 'Compression and leak-down where indicated'] },
    { key: 'transmission', label: 'Transmission / gearbox', description: 'Gearbox, clutch or torque converter, and driveline coupling.', exteriorNodes: [], inspectionFocus: ['Check transmission fluid condition and level', 'Verify shift quality and engagement delays', 'Scan transmission control codes and live data', 'Inspect mounts and driveline joints'] },
    { key: 'battery', label: 'Battery / charging', description: 'Battery, alternator, terminals, grounds and charging circuit.', exteriorNodes: [], inspectionFocus: ['Load-test the battery', 'Inspect terminals, grounds and fuses', 'Measure charging voltage and alternator output', 'Check accessory belt condition'] },
    { key: 'radiator', label: 'Radiator', description: 'Radiator core, cap, hoses and front-end airflow path.', exteriorNodes: [], inspectionFocus: ['Inspect core for damage or obstruction', 'Check cap, hoses and clamps after cooling', 'Verify coolant level and condition', 'Check airflow and fan shroud'] },
    { key: 'cooling_system', label: 'Cooling system', description: 'Thermostat, coolant temperature sensing, pump and cooling fans.', exteriorNodes: [], inspectionFocus: ['Compare scan-tool temperature with a warm-up trace', 'Verify thermostat opening temperature', 'Check water pump and circulation', 'Verify cooling fan operation'] },
    { key: 'brakes', label: 'Braking system', description: 'Brake discs, calipers, pads and hydraulic circuit.', exteriorNodes: ['brake'], inspectionFocus: ['Measure pad and disc wear', 'Inspect calipers, hoses and fluid', 'Check ABS codes and sensor wiring', 'Road-test braking balance where safe'] },
    { key: 'front_suspension', label: 'Front suspension', description: 'Front struts, control arms, ball joints and anti-roll linkage.', exteriorNodes: [], inspectionFocus: ['Inspect struts and mounts for leakage', 'Check ball joints, bushings and tie-rod ends', 'Check spring condition and ride height', 'Perform a suspension play inspection'] },
    { key: 'rear_suspension', label: 'Rear suspension', description: 'Rear springs or struts, linkage, bushings and dampers.', exteriorNodes: [], inspectionFocus: ['Check dampers for leakage and response', 'Inspect bushes and link rods', 'Check spring condition and ride height', 'Inspect rear hub and bearing play'] },
    { key: 'steering', label: 'Steering system', description: 'Steering rack, column, linkages and power assistance.', exteriorNodes: ['steering_wheel', 'steering_column'], inspectionFocus: ['Check steering play and free movement', 'Inspect rack, boots and tie rods', 'Check power-assist fluid or electric assist faults', 'Verify wheel alignment after repair'] },
    { key: 'wheels_tyres', label: 'Wheels and tyres', description: 'Road wheels, rims and tyres including tread and pressure.', exteriorNodes: ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr', 'rim_fl', 'rim_fr', 'rim_rl', 'rim_rr', 'tire'], inspectionFocus: ['Measure tread depth and check uneven wear', 'Set tyre pressures to specification', 'Inspect rims for cracks or damage', 'Check wheel balance and alignment'] },
    { key: 'exhaust', label: 'Exhaust system', description: 'Exhaust manifold, pipework, catalysts, muffler and oxygen sensors.', exteriorNodes: [], inspectionFocus: ['Check for exhaust leaks', 'Review catalyst efficiency codes', 'Inspect oxygen sensor activity after warm-up', 'Inspect mounts and pipework corrosion'] },
  ],
  faultComponentMap: {
    'Engine misfire': 'engine',
    'Lean air-fuel mixture': 'engine',
    'EVAP system leak': 'engine',
    'Cooling system temperature / thermostat': 'cooling_system',
    'Catalyst system efficiency': 'exhaust',
    'Low system voltage / charging': 'battery',
  },
  modelMetadata: {
    exteriorModel: 'Ferrari 458 Italia, model by vicent091036, CC BY 4.0, distributed by three.js examples',
    exteriorModelPath: '/assets/models/ferrari.glb',
    exteriorModelIsGeneric: true,
    interactiveComponentsSource: 'Procedural R3F mechanical assembly (not nodes inside the exterior GLB), plus real wheel/brake/steering nodes in the exterior model where named',
  },
};

export const COMPONENT_KEYS: ComponentKey[] = SMART_WORKSHOP_CONFIG.components.map((component) => component.key);

export interface SmartWorkshopConfig {
  version: string;
  components: SmartWorkshopComponent[];
  faultComponentMap: Record<string, ComponentKey>;
  modelMetadata: Record<string, string | boolean>;
}

export interface SmartWorkshopInspection {
  component_name: string;
  condition?: string;
  condition_status?: string;
  inspection_date: string;
  inspection_notes?: string | null;
  inspected_by_name?: string | null;
}

export interface SmartWorkshopPrediction {
  affected_component: string | null;
  predicted_fault: string;
  confirmed_fault: string | null;
  review_status: string;
  confidence: number;
  created_at: string;
}

export interface ComponentStatus {
  key: ComponentKey;
  status: WorkshopStatus;
  reason: string;
  latestInspection: SmartWorkshopInspection | null;
  pendingPredictions: number;
  confirmedPredictions: number;
  inspectionCount: number;
}

export const INSPECTION_CONDITIONS: { value: InspectionCondition; label: string; status: WorkshopStatus }[] = [
  { value: 'no_fault_found', label: 'No fault found on inspection', status: 'green' },
  { value: 'inspection_recommended', label: 'Inspection recommended', status: 'orange' },
  { value: 'possible_fault', label: 'Possible fault identified', status: 'red' },
  { value: 'fault_confirmed', label: 'Fault confirmed by mechanic', status: 'red' },
];

export const STATUS_LABELS: Record<WorkshopStatus, string> = {
  green: 'No known fault reported',
  orange: 'Inspection recommended',
  red: 'Possible fault identified',
  grey: 'No inspection information available',
};

export function isComponentKey(value: unknown): value is ComponentKey {
  return typeof value === 'string' && ['engine', 'transmission', 'battery', 'radiator', 'cooling_system', 'brakes',
    'front_suspension', 'rear_suspension', 'steering', 'wheels_tyres', 'exhaust'].includes(value);
}

/** Returns null when the fault has no configured component; nothing is highlighted in that case. */
export function componentForFault(fault: string, map: Record<string, ComponentKey> = SMART_WORKSHOP_CONFIG.faultComponentMap): ComponentKey | null {
  const trimmed = fault.trim();
  if (map[trimmed]) return map[trimmed];
  const caseInsensitive = Object.entries(map).find(([name]) => name.toLowerCase() === trimmed.toLowerCase());
  return caseInsensitive ? caseInsensitive[1] : null;
}

function byDateDesc<T extends { created_at?: string; inspection_date?: string }>(items: T[], field: 'created_at' | 'inspection_date'): T[] {
  return [...items].sort((a, b) => String(b[field] ?? '').localeCompare(String(a[field] ?? '')));
}

function conditionStatus(condition: string | undefined): WorkshopStatus | null {
  if (!condition) return null;
  const match = INSPECTION_CONDITIONS.find((entry) => entry.value === condition);
  return match ? match.status : null;
}

/**
 * Central status rule: red > orange > green > grey.
 * GREEN is only returned when an inspection explicitly recorded "no_fault_found";
 * the absence of a fault record never implies a healthy component.
 */
export function deriveComponentStatuses(
  componentKeys: ComponentKey[],
  inspections: SmartWorkshopInspection[],
  predictions: SmartWorkshopPrediction[],
): Record<ComponentKey, ComponentStatus> {
  const result = {} as Record<ComponentKey, ComponentStatus>;
  for (const key of componentKeys) {
    const componentInspections = byDateDesc(
      inspections.filter((entry) => entry.component_name === key), 'inspection_date');
    const componentPredictions = byDateDesc(
      predictions.filter((entry) => entry.affected_component === key), 'created_at');
    const pending = componentPredictions.filter((entry) => entry.review_status === 'pending');
    const confirmed = componentPredictions.filter((entry) => entry.review_status === 'confirmed' || entry.review_status === 'corrected');
    const redInspections = componentInspections.filter((entry) => conditionStatus(entry.condition) === 'red');
    const orangeInspections = componentInspections.filter((entry) => conditionStatus(entry.condition) === 'orange');
    const cleanInspections = componentInspections.filter((entry) => conditionStatus(entry.condition) === 'green');

    let status: WorkshopStatus = 'grey';
    let reason = 'No inspection or prediction has been recorded for this component.';
    if (redInspections.length || confirmed.length) {
      status = 'red';
      reason = redInspections.length
        ? `${redInspections.length} recorded inspection finding(s) report a possible or confirmed fault.`
        : `${confirmed.length} mechanic-reviewed AI prediction(s) relate to this component.`;
    } else if (pending.length || orangeInspections.length) {
      status = 'orange';
      reason = pending.length
        ? `${pending.length} unreviewed AI prediction(s) need mechanical inspection.`
        : `${orangeInspections.length} inspection(s) recommend a follow-up check.`;
    } else if (cleanInspections.length) {
      status = 'green';
      reason = `A mechanic recorded "no fault found" on ${cleanInspections[0].inspection_date.slice(0, 10)}.`;
    }

    result[key] = {
      key,
      status,
      reason,
      latestInspection: componentInspections[0] ?? null,
      pendingPredictions: pending.length,
      confirmedPredictions: confirmed.length,
      inspectionCount: componentInspections.length,
    };
  }
  return result;
}
