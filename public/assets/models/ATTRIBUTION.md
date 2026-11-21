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

## volkswagen/golf.glb

- **Model:** MK Golf - Low Poly (low-poly Volkswagen Golf Mk-series representation)
- **Creators:** Yogoshimo 2.0 (Poly Pizza uploader) and YogoshimoMortiz (original creator stated in the model description)
- **Model page:** https://poly.pizza/m/2u4e9d0aePt
- **Original direct file:** https://static.poly.pizza/01b224c8-c318-409c-ba48-34ba74921c60.glb
- **Licence:** Creative Commons Attribution 3.0 Unported (CC BY 3.0)
  https://creativecommons.org/licenses/by/3.0/
- **Licence evidence:** The Poly Pizza model page states “Creative Commons Attribution” and links to CC BY 3.0; the page metadata reports `Licence: CC-BY 3.0`.
- **Original SHA-256:** `f15b0613e5a4b7c8cc5cce028610875de5f00a57c75cd756550340d8795a5307` (73,020 bytes)
- **Stored SHA-256:** `eaeb958d4e586bf50476a2796003de2dc6d728d25a7f8c39d1499563772dcfba` (74,340 bytes)
- **Changes:** The downloaded GLB was re-centred on X/Z, grounded at Y=0, non-uniformly scaled to approximately 4.2 m length, 1.85 m width and 1.55 m height, and its vertex normals were renormalized for that scale. No vertices, triangles or faces were added or removed, and no textures were added. Runtime lighting and material transparency are adjusted by the viewer.
- **Use in NEXTGEN:** Registered as the Volkswagen Golf catalogue asset (`vw-golf`). It is a named Golf Mk-series representation, not a verified exact generation, model year or trim. No component node names were supplied or verified, so no exterior part is clickable. Interior is unavailable; mechanical and exploded views remain procedural inspection assemblies. No affiliation with or endorsement by Volkswagen or the creators is implied.

Attribution text for UI/API metadata: “MK Golf - Low Poly” by Yogoshimo 2.0 / YogoshimoMortiz (Poly Pizza), CC BY 3.0.

## Draco decoder (`/draco/`)

- **Source:** three.js (`node_modules/three/examples/jsm/libs/draco/gltf/`)
- **Copyright:** Draco 3D Data Compression, Google Inc.
- **License:** Apache License 2.0
- **Purpose:** Decodes the `KHR_draco_mesh_compression` extension used by `ferrari.glb`.
  Served locally so the workshop does not depend on an external CDN.
