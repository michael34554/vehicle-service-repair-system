import type { ComponentKey, WorkshopStatus } from '@/shared/smartWorkshop';

export type ViewerMode = 'exterior' | 'internal';
export type ViewStyle = 'normal' | 'transparent' | 'exploded';
export type CameraPreset = 'perspective' | 'front' | 'rear' | 'left' | 'right' | 'roof' | 'wheels';

export const STATUS_COLORS: Record<WorkshopStatus, string> = {
  green: '#22c55e',
  orange: '#f97316',
  red: '#ef4444',
  grey: '#94a3b8',
};

export const CAMERA_PRESETS: Record<CameraPreset, { position: [number, number, number]; target: [number, number, number] }> = {
  perspective: { position: [4.3, 1.7, -4.6], target: [0, 0.55, 0] },
  front: { position: [0, 0.9, -6.2], target: [0, 0.55, 0] },
  rear: { position: [0, 0.9, 6.2], target: [0, 0.55, 0] },
  left: { position: [-6.2, 1.1, 0], target: [0, 0.55, 0] },
  right: { position: [6.2, 1.1, 0], target: [0, 0.55, 0] },
  roof: { position: [0.01, 7.2, 0.01], target: [0, 0.35, 0] },
  wheels: { position: [2.6, 0.5, -2.6], target: [-0.4, 0.35, -1.1] },
};

/** Named GLB nodes that represent a supported inspection component. */
export const EXTERIOR_NODE_COMPONENTS: Record<string, ComponentKey> = {
  wheel_fl: 'wheels_tyres',
  wheel_fr: 'wheels_tyres',
  wheel_rl: 'wheels_tyres',
  wheel_rr: 'wheels_tyres',
  rim_fl: 'wheels_tyres',
  rim_fr: 'wheels_tyres',
  rim_rl: 'wheels_tyres',
  rim_rr: 'wheels_tyres',
  tire: 'wheels_tyres',
  brake: 'brakes',
  steering_wheel: 'steering',
  steering_column: 'steering',
};

export const MODEL_PATH = '/assets/models/ferrari.glb';
export const DRACO_PATH = '/draco/';
