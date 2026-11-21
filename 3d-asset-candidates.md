# 3D asset candidate queue — AI Smart Workshop

**Status: mixed.** The Volkswagen Golf entry below has been downloaded,
normalized, registered as `vw-golf` and linked to the existing Golf catalogue
model. Every other candidate remains proposed only: no other candidate has been
downloaded, added to `public/assets/models/`, registered in
`vehicle_3d_assets`, or linked to a catalogue model. The Ferrari 458 Italia GLB
remains a clearly labelled, non-selectable generic illustration and is never
substituted for a selected vehicle.

This queue exists because the current viewer supports per-model GLB selection,
named-node highlighting, 360° orbit/zoom and procedural mechanical views, but
the repository now contains one model-specific Golf body asset, one generic
Ferrari illustration and no verified model-specific interior asset.

## Evaluation legend

- **Verified** – accessible file plus primary/strong license evidence found.
- **Conditional** – license is visible, but direct download rights, exact file,
  or attribution details still need confirmation before use.
- **Not suitable** – real asset, but it does not meet the workshop requirement.
- **Redistribution** – whether the file can be committed to this repository.
  CC0 and CC BY assets are treated as redistributable with the stated
  attribution obligations; CC BY-SA needs additional review; Sketchfab download
  mechanics must be checked separately.

## Strong candidates

| ID | Candidate | Manufacturer/model match | Author / source | License evidence | File / size | Redistribution | Intended use | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `vw-golf-poly-pizza` | Volkswagen Golf Mk-series (low-poly) | Named Golf Mk-series representation; generation, model year and trim not established. Registered to the existing `vw-golf` catalogue model. | Yogoshimo 2.0 (uploader) / YogoshimoMortiz (original creator); [Poly Pizza model page](https://poly.pizza/m/2u4e9d0aePt) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) confirmed by the model page and its embedded metadata. | Local `public/assets/models/volkswagen/golf.glb`, 74,340 bytes / 680 tris; original 73,020 bytes. | Yes, with attribution; GLB re-centred, grounded and scaled with normals renormalized. | Model-specific Golf exterior. No verified component nodes; no interior; mechanical/exploded views are procedural. | **Already integrated** |
| `r34-lexyc16` | Nissan Skyline R34 GT-R | Exact model: Nissan Skyline R34 GT-R. Not currently a catalogue model; add `nissan-skyline-r34-gt-r` or use as a labelled Nissan representative. | Lexyc16; [original Sketchfab model](https://sketchfab.com/3d-models/nissan-skyline-r34-gt-r-ff8fb2251dfa4bb9979e7022c5a6666c); redistributed in [ohmiler/R34-Midnight-Garage](https://github.com/ohmiler/R34-Midnight-Garage) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); stated in the [repository README](https://raw.githubusercontent.com/ohmiler/R34-Midnight-Garage/main/README.md) and linked to the original model. GitHub repository license field is empty, so attribution must quote the README and original model page. | [Raw GLB](https://raw.githubusercontent.com/ohmiler/R34-Midnight-Garage/main/nissan_skyline_r34_gt-r.glb), 5,048,896 bytes. README says a prepared 4.35 MB derivative exists but the original is preserved in the repo. | Yes, with author/title/source/license attribution in `ATTRIBUTION.md`, API metadata and UI. | Exterior model for Nissan; candidate for a new exact catalogue model. Mesh/node map must be inspected before any component is clickable. | **Verified with attribution caveat** |
| `bmw-x5-e53-powerbridge` | BMW X5 E53 Restyling | Exact BMW X5 E53. Useful for the existing `bmw-x3` model only as a labelled BMW representative, or add a new `bmw-x5-e53` model. | takeover / takeoverteam; [Sketchfab source](https://sketchfab.com/3d-models/bmw-x5-e53-restyling-high-quality-1dfdb422f05d44b287e332bec4311c50); [API evidence](https://api.sketchfab.com/v3/models/1dfdb422f05d44b287e332bec4311c50); redistributed in [PowerBridge-ai/tg-vehicle-library](https://github.com/PowerBridge-ai/tg-vehicle-library) | CC BY 4.0 confirmed by Sketchfab API and embedded GLB `asset.extras`; link the [license](https://creativecommons.org/licenses/by/4.0/) and credit the author. PowerBridge repo has no blanket license; rely on embedded attribution. | [Raw GLB](https://raw.githubusercontent.com/PowerBridge-ai/tg-vehicle-library/master/0000_bmw_e53-restyling_1dfdb4.glb), 29,224,656 bytes; ~209,596 tris / 455,485 verts; 36 images. | Yes, with attribution. | Realistic exact BMW exterior; no interior in manifest. Large file, so optimize before using as a default. Node map pending. | **Verified direct file; heavy** |
| `mercedes-amgt-2016` | Mercedes-Benz AMG GT 2016 | Exact 2016 Mercedes-AMG GT, not an exact match for current C-Class/E-Class/GLC/A-Class models. Add a new catalogue model or label as Mercedes representative. | 3D Cars Studio / Ahmed Fadl Elsayed; [Sketchfab source](https://sketchfab.com/3d-models/mercedes-benz-amg-gt-2016-323167df949a45939d955430cce75d4f); [API evidence](https://api.sketchfab.com/v3/models/323167df949a45939d955430cce75d4f); redistributed in [PowerBridge-ai/tg-vehicle-library](https://github.com/PowerBridge-ai/tg-vehicle-library) | CC BY 4.0 confirmed by Sketchfab API and embedded GLB metadata. | [Raw GLB](https://raw.githubusercontent.com/PowerBridge-ai/tg-vehicle-library/master/2016_mercedes-benz_amg_with-interior_323167.glb), 39,219,716 bytes; ~1,311,059 tris / 726,550 verts. | Yes, with attribution. | Exact Mercedes with interior. Very heavy for web; optimize/decimate before integration. | **Verified direct file; optimize required** |
| `ford-gt40-mk2` | Ford GT40 Mark II | Exact Ford GT40 Mk II; not an exact match for current Ranger/Focus/Everest/Fiesta models. Use only if a GT40 catalogue model is added or as a labelled Ford representative. | vecarz / heynic; original by Randomness; [reupload page](https://sketchfab.com/3d-models/ford-gt40-mark-ii-wwwvecarzcom-16e6376958604b3d83b541ee67f4b4c9); [original page](https://sketchfab.com/3d-models/ford-gt40-mkii-15a8dd8f0302470a99fdafb01e1e50f1); both CC BY 4.0; redistributed in [Vivekkk-1/3D-Models](https://github.com/Vivekkk-1/3D-Models) | CC BY 4.0 confirmed in both Sketchfab records and embedded GLB metadata. Credit both vecarz/heynic and original creator Randomness. | [Raw GLB](https://raw.githubusercontent.com/Vivekkk-1/3D-Models/main/Cars/ford_gt40.glb), 11,370,572 bytes; ~193,089 tris / 173,217 verts; 41 images. | Yes, with dual attribution. | Exact Ford GT40 exterior. Direct file; node map pending. | **Verified direct file** |
| `bmw-m4-web` | BMW M4 Competition M Package | Exact BMW M4; not an exact match for current 3/5/X3/1 Series models. | 𝙎𝙍𝙏 𝙋𝙚𝙧𝙛𝙤𝙧𝙢𝙖𝙣𝙘𝙚™; [attribution file](https://github.com/lukaizj/car-mod-saas/blob/main/public/models/ATTRIBUTION.md); [repository](https://github.com/lukaizj/car-mod-saas) | CC BY 4.0 confirmed by attribution file and embedded GLB `asset.extras`. | [Web GLB](https://raw.githubusercontent.com/lukaizj/car-mod-saas/main/public/models/bmw-m4.web.glb), 3,886,832 bytes / ~179,033 tris; [source GLB](https://raw.githubusercontent.com/lukaizj/car-mod-saas/main/public/models/bmw-m4.glb), 22,739,084 bytes / ~206,593 tris. | Yes, with attribution. | Exact BMW M4 web-optimized derivative. Web GLB uses Meshopt/WebP/quantization and requires GLTFLoader decoder setup; source GLB is simpler but much larger. Node map pending. | **Verified direct file; decoder caveat** |
| `modern-car-interior` | Modern Car Interior | Generic modern cabin, not manufacturer-specific. | Grab3D; [model page](https://grab3d.com/models/vehicles/modern-car-interior/) | [CC0 1.0](https://grab3d.com/license/); page states “Free under CC0 for personal and commercial use, no attribution.” | [Full GLB](https://grab3d.com/dl/modern-car-interior/modern-car-interior.glb) 5.6 MB; [light GLB](https://grab3d.com/dl/modern-car-interior/modern-car-interior-light.glb) 1.1 MB; 38,096 / 20,470 triangles. | Yes. Attribution still recommended in `ATTRIBUTION.md` for provenance, though CC0 does not require it. | Interior view: open cutaway with dashboard, touchscreen, digital cluster, front/rear seats, steering wheel, pedals, door panels and windshield frame. Stylized/lightweight, not a photorealistic manufacturer interior. | **Verified** |
| `sports-car-cockpit` | Sports Car Cockpit | Generic two-seat sports cockpit, not manufacturer-specific. | Grab3D; [model page](https://grab3d.com/models/vehicles/sports-car-cockpit/) | [CC0 1.0](https://grab3d.com/license/); page states “Free under CC0 for personal and commercial use, no attribution.” | [Full GLB](https://grab3d.com/dl/sports-car-cockpit/sports-car-cockpit.glb) 5.5 MB; [light GLB](https://grab3d.com/dl/sports-car-cockpit/sports-car-cockpit-light.glb) 1.1 MB; 36,170 / 19,277 triangles. | Yes. | Alternative interior view for two-seat/roadster models such as MX-5 or Ferrari fallback. Includes seats, dashboard, steering wheel, gear stick, pedals, harnesses and roll bar. | **Verified** |
| `car-concept-khronos` | Car Concept | Concept car, not a production model. Use as a high-quality representative exterior/interior, never as Toyota/Nissan/VW/etc. | Darmstadt Graphics Group GmbH and Eric Chadwick; [Khronos model page](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept); derived from a public-domain model by Unity Fan. | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); [LICENSE.md](https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/LICENSE.md) and [README legal section](https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/README.md). Khronos/3D Commerce logos are excluded from the grant. | [GLB](https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/glTF-Binary/CarConcept.glb), 11,778,688 bytes. Compressed glTF+KTX2+Draco variant ≈10.3 MB download / 14.9 MB VRAM. | Yes, with attribution; do not present excluded logos as licensed content. | Higher-fidelity representative exterior with interior materials, logically named parts, pivots for opening doors/hood/hatch, glass, lights, brakes, wheels and dashboard materials. Need node inspection before mapping. | **Verified** |
| `spectral-gt-rs` | Spectral GT RS | Fictional procedural sports car; representative only. | JaronKBragg7337; [repository](https://github.com/JaronKBragg7337/spectral-gt-rs) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/); [LICENSE](https://raw.githubusercontent.com/JaronKBragg7337/spectral-gt-rs/main/LICENSE) and [README](https://raw.githubusercontent.com/JaronKBragg7337/spectral-gt-rs/main/README.md). | [Game-ready GLB](https://raw.githubusercontent.com/JaronKBragg7337/spectral-gt-rs/main/spectral_gt_rs_game_ready.glb), 4,688,844 bytes; 263 exported objects including 59 mechanical-detail objects. | Yes, CC0; no attribution required. | One GLB containing exterior, detailed cockpit (dashboard, displays, seats, belts, steering wheel, shifter, door panels) and mechanical nodes (engine bay, radiator, turbo, control arms, dampers/coil springs, brake discs/calipers, exhaust). Animations include doors, hood and steering. Game-ready procedural PBR, not CAD-accurate or photoreal scan. | **Verified** |
| `grab3d-car-parts` | Grab3D Cozy Car Parts & Garage Kit | Generic components, not manufacturer-specific. | Grab3D; [kit page](https://grab3d.com/kits/cozy-car-parts/) | [CC0 1.0](https://grab3d.com/license/) plus per-model `LICENSE.txt` / `manifest.json`, e.g. [radiator license](https://grab3d.com/dl/car-radiator/LICENSE.txt). | Direct GLBs: [inline-4 engine](https://grab3d.com/dl/car-engine/car-engine.glb) 1.35 MB / 19,668 tris; [V8 engine](https://grab3d.com/dl/v8-engine/v8-engine.glb) 1.52 MB / 19,988 tris; [manual gearbox](https://grab3d.com/dl/gearbox/gearbox.glb) 0.90 MB / 8,504 tris; [brake disc](https://grab3d.com/dl/brake-disc/brake-disc.glb) 0.74 MB / 8,122 tris; [radiator](https://grab3d.com/dl/car-radiator/car-radiator.glb) 0.97 MB / 7,688 tris; [battery](https://grab3d.com/dl/car-battery/car-battery.glb) 0.79 MB / 6,732 tris; [shock](https://grab3d.com/dl/shock-absorber/shock-absorber.glb) 0.72 MB / 6,424 tris; [muffler](https://grab3d.com/dl/exhaust-muffler/exhaust-muffler.glb) 0.47 MB / 5,044 tris. | Yes, CC0. | Replace or supplement procedural mechanical components with licensed models for engine, gearbox, brakes, cooling, battery, suspension and exhaust. Stylized, not OEM-accurate; must stay labelled generic. | **Verified** |
| `grab3d-mechanical-parts` | Grab3D Cozy Mechanical Parts Kit | Generic teaching components, not manufacturer-specific. | Grab3D; [kit page](https://grab3d.com/kits/cozy-mechanical-parts/) | [CC0 1.0](https://grab3d.com/license/) plus per-model license/manifest files. | Direct GLBs: [differential cutaway](https://grab3d.com/dl/differential/differential.glb) 2.87 MB / 38,618 tris with `rotor_a` / `rotor_b`; [camshaft](https://grab3d.com/dl/camshaft/camshaft.glb) 1.53 MB / 19,312 tris with `rotor`; [coil spring set](https://grab3d.com/dl/coil-spring/coil-spring.glb) 1.33 MB / 19,344 tris. | Yes, CC0. | Exploded/educational views for drivetrain, valvetrain and suspension. Stylized/simplified, not OEM-accurate. | **Verified** |
| `ferrari-458-threejs` | Ferrari 458 Italia (already bundled) | Exact Ferrari 458 Italia, but representative only and non-selectable in catalogue mode. | vicent091036; three.js example | CC BY 4.0; [evidence](https://github.com/mrdoob/three.js/issues/23089#issuecomment-1001258942) | Local `public/assets/models/ferrari.glb`, 1,681,572 bytes; Draco compressed. | Already in repository with attribution. | Generic labelled illustration only; never substituted for a selected vehicle. | **Already integrated (generic, non-selectable)** |

## Recommended approval packages

Choose one or more; all are local-first and keep the current auth/API/database:

- **A — Direct-file exact set (recommended):** `r34-lexyc16`, `bmw-m4-web` and `ford-gt40-mk2` as exact model exteriors, plus `modern-car-interior` (light GLB) for the interior view and `grab3d-car-parts` for generic mechanical components. All have direct download URLs; total selected download is roughly 22 MB. Optional `bmw-x5-e53-powerbridge` and `mercedes-amgt-2016` add more exact models but are much heavier.
- **B — Best single detailed illustrative vehicle:** `spectral-gt-rs` alone. It includes exterior, cockpit and mechanical detail in one CC0 GLB, but it is a fictional car and must remain representative.
- **C — Highest visual polish representative:** `car-concept-khronos` as a high-quality PBR concept car with interior/logical part names. More attribution obligations and a larger download; still not a serviceable production model.
- **D — Keep current assets, improve only procedural detail:** no download; extend the procedural interior/mechanical meshes. Lowest legal risk but does not meet the realistic model-specific asset requirement.
- **E — Manufacturer-specific exact models (manual download):** add new catalogue models for the verified exact vehicles in the next table. These are CC BY and downloadable, but Sketchfab does not expose an unauthenticated direct GLB URL, so the files must be downloaded manually and supplied before integration.

## Verified exact models — manual download required

Sketchfab API v3 confirms each model is `isDownloadable: true`, `isProtected: false`, and CC BY 4.0. The API download endpoint requires authentication; use each model page’s **Download GLB** button. Polycount/size figures are from Sketchfab’s GLB archive metadata. None of these files are in the repository yet.

| Intended new `model_id` | Exact model | Author / source | License evidence | GLB size / polygons | Caveats |
| --- | --- | --- | --- | --- | --- |
| `toyota-mr2-w20` | 1996 Toyota MR2 W20 | `_shobh19`; [model page](https://sketchfab.com/3d-models/1996-toyota-mr2-w20-f66020ee62d741ebb0adc1ba351300db); [API](https://api.sketchfab.com/v3/models/f66020ee62d741ebb0adc1ba351300db) | CC BY 4.0; author must be credited, commercial use allowed | 1,633,876 bytes; 25,268 faces; 3 textures | Low-poly, no interior. Good lightweight exact Toyota. |
| `nissan-skyline-r34-gt-r` | Nissan Skyline R34 GT-R | Lexyc16; [model page](https://sketchfab.com/3d-models/nissan-skyline-r34-gt-r-ff8fb2251dfa4bb9979e7022c5a6666c); [API](https://api.sketchfab.com/v3/models/ff8fb2251dfa4bb9979e7022c5a6666c) | CC BY 4.0 | 5,048,896 bytes; 62,468 faces; 6 textures | Also available as a direct GitHub GLB in the strong-candidates table. Author notes geometry problems. |
| `vw-golf-mk1-tuning` | Volkswagen Golf Mk1 [Tuning] | Black Snow; [model page](https://sketchfab.com/3d-models/volkswagen-golf-mk1-tuning-191d4905f1274cee8539a39a0a672fd9); [API](https://api.sketchfab.com/v3/models/191d4905f1274cee8539a39a0a672fd9) | CC BY 4.0 | 14,147,196 bytes; 249,811 faces; 9 textures | Tuned/aftermarket styling; not a stock Golf Mk1. |
| `honda-nsx-1990` | Honda NSX 1990 | Lexyc16; [model page](https://sketchfab.com/3d-models/honda-nsx-1990-1cc15628a00a4739a6b6c01128927c8d); [API](https://api.sketchfab.com/v3/models/1cc15628a00a4739a6b6c01128927c8d) | CC BY 4.0 | 6,604,608 bytes; 100,362 faces; 4 textures | Good mid-size exact Honda. |
| `mazda-rx7-fd` | Mazda RX-7 FD | Lexyc16; [model page](https://sketchfab.com/3d-models/mazda-rx-7-fd-d35ff630df614771b82e7b2f59035b1e); [API](https://api.sketchfab.com/v3/models/d35ff630df614771b82e7b2f59035b1e) | CC BY 4.0 | 5,243,568 bytes; 37,112 faces; 6 textures | Lightweight exact Mazda. |
| `hyundai-tucson-2015` | 2015 Hyundai Tucson | razor24; [model page](https://sketchfab.com/3d-models/2015-hyundai-tucson-7674a3bd168a451daf73fc0a33d39589); [API](https://api.sketchfab.com/v3/models/7674a3bd168a451daf73fc0a33d39589) | CC BY 4.0 | 1,152,688 bytes; 33,152 faces; 1 texture | Very small; simple/untextured appearance. Matches existing `hyundai-tucson` catalogue model closely. |
| `mitsubishi-3000gt-1999` | 1999 Mitsubishi 3000GT | Randomness; [model page](https://sketchfab.com/3d-models/1999-mitsubishi-3000gt-51bd360e553741caa77b8f85eaf184b1); [API](https://api.sketchfab.com/v3/models/51bd360e553741caa77b8f85eaf184b1) | CC BY 4.0 | 6,100,580 bytes; 57,155 faces; 21 textures | Author says a wheel is missing; inspect before use. |

Rights-risk models explicitly excluded: CC BY-NC and CC BY-NC-SA vehicles, the contradictory BMW X6M entry, the Hyundai i20 WRC reupload, and the free-concept-car entry whose API license is “Free Standard” rather than a clean CC0 grant. CC BY-SA was not shortlisted because no candidate justified the share-alike obligation.

## Conditional leads — do not use yet

| Candidate | Model match | Why it is not approved yet |
| --- | --- | --- |
| [Toyota Corolla by Nieve5677](https://sketchfab.com/3d-models/toyota-corolla-723da379600d4fb9a3e9687e99ca68d5) | Exact Toyota Corolla (year/trim not stated on page) | Sketchfab page shows CC BY, but direct download method, author attribution text, exact year/trim and node names are unverified. 444.6k triangles, so performance also needs review. |
| [Volkswagen Golf 8R by DR1KING100K](https://sketchfab.com/3d-models/volkswagen-golf-8r-7d175b0edaff42b79fa7df973e69d75a) | Exact VW Golf 8R | CC BY shown, but 1.5M triangles / 830.5k vertices is heavy for the workshop viewer. Direct download rights and exact attribution details still need confirmation. |
| [Volkswagen Golf 7 Mk7 by DR1KING100K](https://sketchfab.com/3d-models/volkswagen-golf-7-mk7-3c86d324d56f4027b08cbd7ba5f10bbb) | Exact VW Golf Mk7 | CC BY shown; file access and exact attribution still need confirmation. Check size before approval. |
| [`pedrosoandre/carros`](https://github.com/pedrosoandre/carros) | Large library of Brazilian-market cars including Ford and other makes | Search result described CC BY models with ready credits, but the repository was not reachable through the GitHub API when checked. Treat as unverified/dead until confirmed. |
| Sketchfab pages in the conditional leads above | Various manufacturer/interior/mechanical matches | Sketchfab exposes author and license metadata but downloads are login-gated; no raw direct GLB URL was found. The separately listed “Verified exact models” table has stronger evidence, but those files also require manual authenticated download. |

## Not suitable for realistic workshop vehicles

| Candidate | Reason |
| --- | --- |
| [Khronos ToyCar](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ToyCar) | CC0 and technically accessible ([5.4 MB GLB](https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/ToyCar/glTF-Binary/ToyCar.glb)), but it is explicitly a toy car material demo, not a realistic service-repair vehicle. |
| Generic low-poly city-car packs | Body proportions, lights, windows and interiors are stylized; they would not satisfy the realistic body/interior requirement. |
| Legacy Khronos samples `2CylinderEngine`, `GearboxAssy`, `ReciprocatingSaw`, `Buggy` | Removed from the current glTF sample set during license/provenance cleanup; do not use in a redistributed app unless provenance is resolved. See the [archived license issue](https://github.com/KhronosGroupArchives/glTF-Sample-Models/issues/227). |
| CC BY-NC Sketchfab engines, gearboxes and calipers | Non-commercial restriction conflicts with a commercial workshop system. |

## Integration plan — prepared, not yet applied

1. **Approve the exact candidate set.** For each approved asset, record the
   chosen file (full vs light), exact `model_id`, whether it is `exact` or
   `representative`, and the attribution text.
2. **Download to `public/assets/models/`** only after approval. Do not fetch at
   runtime; the app must continue serving all assets locally.
3. **Inspect with `node scripts/inspectGltfAssets.mjs <file>`**. The script is a
   read-only GLB inspector that lists node/mesh names, bounds and keyword
   suggestions. Keyword suggestions are never auto-approved as component maps.
4. **Normalize runtime transform.** Add an asset transform record (scale,
   rotation and offset) where the GLB units or up-axis differ from the current
   viewer. The integrated Golf GLB was normalized before storage, with the
   change recorded in `ATTRIBUTION.md`; the Ferrari asset is unchanged.
5. **Build exact node maps.** Only real, inspected node names are stored in
   `vehicle_3d_assets.node_map_json`. Unmapped mechanical components remain in
   the clearly labelled procedural assembly.
6. **Register assets idempotently** in `server/smartWorkshopSeed.ts` with
   `asset_key`, license, license URL, source, generic/exact flags and node map.
   Link the chosen `vehicle_models.asset_key` and set `asset_status` truthfully
   (`exact` only when the asset really matches that model).
7. **Add interior asset support.** The current `interior` mode shows a
   transparent exterior plus the procedural mechanical assembly. For approved
   interior GLBs, add a separate interior asset link/role and render it in
   interior mode with dashboard, steering wheel and seats visible. Do not claim
   it is manufacturer-matched unless it is.
8. **Update attribution and UI.** Extend
   `public/assets/models/ATTRIBUTION.md`, the catalogue API metadata and the
   Smart Workshop asset notice so every displayed model shows correct author,
   title, source and license.
9. **Verify.** Run `npm run lint`, `npm run build`,
   `node scripts/verifySmartWorkshopDb.mjs`,
   `node scripts/smokeSmartWorkshopApi.mjs`, and a browser visual check of
   exterior/interior/mechanical modes for each new asset.

## Safety and accuracy constraints

- `is_exact_match` means the asset is a named representation of that
  manufacturer/model and not a different vehicle. It does not certify a
  specific generation, model year, trim or engineering geometry unless that is
  independently recorded; the Golf entry explicitly leaves those unverified.
- No component becomes clickable unless a real node name is present in that
  asset's approved node map.
- Interior and mechanical assets are labelled as representative when they are
  generic; procedural assemblies stay labelled procedural.
- AI predictions, inspections and parts/repair workflows are unchanged: a 3D
  highlight is a diagnostic aid, not a confirmed diagnosis or work order.
- Catalogue writes remain restricted to `owner` and `manager`; no customer data
  is exposed through catalogue or asset endpoints.
