# 3D asset attribution

## ferrari.glb / ferrari_ao.png

- **Model:** Ferrari 458 Italia
- **Author:** vicent091036
- **Original:** https://sketchfab.com/3d-models/ferrari-458-italia-57bf6cc56931426e87494f554df1dab6
- **Distributed by:** three.js examples (`examples/models/gltf/ferrari.glb`, `ferrari_ao.png`)
- **Source:** https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf
- **License:** Creative Commons Attribution 4.0 International (CC BY 4.0)
  https://creativecommons.org/licenses/by/4.0/
- **License evidence:** three.js asset-license inventory, issue #23089:
  https://github.com/mrdoob/three.js/issues/23089#issuecomment-1001258942
- **Changes:** none to the GLB binary. Runtime materials, transparency and lighting are
  adjusted by the viewer. The ambient-occlusion contact image is used as a ground shadow.
- **Use in NEXTGEN:** This is a **compatible generic illustrative vehicle**, not an exact
  3D reproduction of any vehicle registered in the workshop. The UI labels it as such.
  No affiliation with or endorsement by Ferrari or the author is implied.

Actual named nodes used for exterior selection: `body`, `glass`, `wheel_fl`, `wheel_fr`,
`wheel_rl`, `wheel_rr`, `rim_fl`, `rim_fr`, `rim_rl`, `rim_rr`, `brake`, `steering_wheel`,
`steering_column`. The model does **not** contain engine, gearbox, battery, radiator,
suspension or exhaust nodes. Those are represented by a separate procedurally generated
3D mechanical assembly in `src/components/smartWorkshop/MechanicalAssembly.tsx`; the
viewer does not claim they are selectable parts of the Ferrari asset.

## Draco decoder (`/draco/`)

- **Source:** three.js (`node_modules/three/examples/jsm/libs/draco/gltf/`)
- **Copyright:** Draco 3D Data Compression, Google Inc.
- **License:** Apache License 2.0
- **Purpose:** Decodes the `KHR_draco_mesh_compression` extension used by `ferrari.glb`.
  Served locally so the workshop does not depend on an external CDN.
