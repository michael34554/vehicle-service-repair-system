import { Suspense, useEffect, useRef, useState, type RefObject } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { ContactShadows, OrbitControls, useProgress } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { ComponentKey, ComponentStatus } from '@/shared/smartWorkshop';
import { ExteriorVehicle } from './ExteriorVehicle';
import { MechanicalAssembly } from './MechanicalAssembly';
import { ErrorBoundary } from './ErrorBoundary';
import { CAMERA_PRESETS, type CameraPreset, type ViewerMode, type ViewStyle } from './viewerConfig';

interface Props {
  statuses: Record<ComponentKey, ComponentStatus>;
  selected: ComponentKey | null;
  mode: ViewerMode;
  style: ViewStyle;
  preset: CameraPreset;
  resetToken: number;
  onSelect: (key: ComponentKey | null) => void;
}

function CameraController({ preset, resetToken, controls }: {
  preset: CameraPreset;
  resetToken: number;
  controls: RefObject<OrbitControlsImpl | null>;
}) {
  const { camera } = useThree();
  useEffect(() => {
    const config = CAMERA_PRESETS[preset];
    camera.position.set(...config.position);
    camera.lookAt(...config.target);
    if (controls.current) {
      controls.current.target.set(...config.target);
      controls.current.update();
    }
  }, [camera, controls, preset, resetToken]);
  return null;
}

function Scene({ props }: { props: Props }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const showBody = props.mode === 'exterior' || props.style === 'transparent' || props.style === 'exploded';
  return (
    <>
      <color attach="background" args={['#0b1220']} />
      <fog attach="fog" args={['#0b1220', 11, 22]} />
      <ambientLight intensity={0.75} />
      <hemisphereLight args={['#dbeafe', '#0f172a', 0.85]} />
      <directionalLight position={[4, 7, -5]} intensity={2.1} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-5, 4, 5]} intensity={0.95} />
      <spotLight position={[0, 6, 3]} angle={0.6} penumbra={0.7} intensity={1.1} />
      <gridHelper args={[14, 28, '#1d4ed8', '#172554']} position={[0, -0.01, 0]} />
      <ContactShadows position={[0, 0.012, 0]} opacity={0.55} scale={9} blur={2.6} far={3} resolution={512} />

      <Suspense fallback={null}>
        {showBody && (
          <ExteriorVehicle
            statuses={props.statuses}
            selected={props.selected}
            style={props.mode === 'exterior' ? props.style : 'transparent'}
            onSelect={props.onSelect}
            interactive={props.mode === 'exterior'}
          />
        )}
        {props.mode === 'internal' && (
          <MechanicalAssembly
            statuses={props.statuses}
            selected={props.selected}
            style={props.style}
            onSelect={props.onSelect}
          />
        )}
      </Suspense>

      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={1.6}
        maxDistance={13}
        maxPolarAngle={Math.PI / 2.02}
      />
      <CameraController preset={props.preset} resetToken={props.resetToken} controls={controls} />
    </>
  );
}

function LoadingOverlay() {
  const { active, progress, errors } = useProgress();
  if (!active && errors.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-slate-950/45">
      <div className="flex items-center gap-3 rounded-lg border border-blue-400/30 bg-slate-900/90 px-4 py-3 text-sm text-blue-100 shadow-xl">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-300 border-t-transparent" />
        {errors.length ? 'A 3D asset could not be loaded.' : `Loading 3D vehicle… ${Math.round(progress)}%`}
      </div>
    </div>
  );
}

export default function VehicleViewer(props: Props) {
  const [failure, setFailure] = useState('');

  useEffect(() => {
    document.body.style.cursor = '';
    return () => { document.body.style.cursor = ''; };
  }, []);

  return (
    <div className="relative h-full min-h-[430px] w-full overflow-hidden rounded-xl bg-slate-950" aria-label="Interactive 3D vehicle viewer">
      <ErrorBoundary
        onError={() => setFailure('The 3D renderer or model could not be started on this device.')}
        fallback={
          <div className="grid h-full min-h-[430px] place-items-center px-6 text-center">
            <div>
              <p className="text-sm font-semibold text-red-300">3D viewer unavailable</p>
              <p className="mt-2 max-w-sm text-xs leading-5 text-slate-400">
                WebGL or the vehicle model could not be loaded. Inspection records and AI analysis remain available.
              </p>
            </div>
          </div>
        }
      >
        <Canvas
          shadows
          dpr={[1, 1.75]}
          camera={{ position: CAMERA_PRESETS.perspective.position, fov: 40, near: 0.1, far: 100 }}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          onPointerMissed={() => props.onSelect(null)}
        >
          <Scene props={props} />
        </Canvas>
      </ErrorBoundary>
      {!failure && <LoadingOverlay />}
      {failure && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-red-950/80 px-3 py-1.5 text-xs text-red-200" role="alert">
          {failure}
        </div>
      )}
      <div className="pointer-events-none absolute bottom-3 right-3 rounded-md bg-slate-900/75 px-3 py-1.5 text-[11px] text-slate-300">
        Drag to rotate · Scroll to zoom · Right-drag to pan · Click a component
      </div>
    </div>
  );
}
