/**
 * Read-only inspector for local GLB assets used by the Smart Workshop viewer.
 *
 * Run with:
 *   node scripts/inspectGltfAssets.mjs
 *   node scripts/inspectGltfAssets.mjs public/assets/models/example.glb
 *
 * It prints the GLB node/mesh names, position bounds and possible component
 * keyword matches. Matches are suggestions for human review only; the catalogue
 * node map must still be approved before a component becomes clickable.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const MODEL_DIRECTORY = join(process.cwd(), 'public', 'assets', 'models');

const COMPONENT_KEYWORDS = {
  wheels_tyres: ['wheel', 'tire', 'tyre', 'rim', 'tyres', 'tires'],
  brakes: ['brake', 'caliper', 'disc', 'rotor'],
  steering: ['steer', 'steering', 'column', 'rack'],
  engine: ['engine', 'motor', 'block', 'head', 'intake', 'exhaust manifold'],
  transmission: ['gear', 'gearbox', 'transmission', 'shifter', 'differential'],
  battery: ['battery', 'alternator', 'battery_'],
  cooling: ['radiator', 'cooling', 'coolant', 'fan', 'thermostat'],
  fuel_system: ['fuel', 'tank', 'injector', 'pump'],
  suspension: ['suspension', 'shock', 'strut', 'spring', 'control arm', 'axle'],
  exhaust: ['exhaust', 'muffler', 'catalytic', 'pipe'],
  electrical: ['wire', 'harness', 'fuse', 'ecu', 'module', 'sensor'],
  body: ['body', 'door', 'hood', 'bonnet', 'fender', 'bumper'],
  glass: ['glass', 'window', 'windshield', 'windscreen', 'mirror'],
  lights: ['headlight', 'headlamp', 'light', 'lamp', 'taillight'],
  interior: ['seat', 'dash', 'dashboard', 'cluster', 'cockpit', 'console', 'steering wheel'],
};

function readUInt32(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

function parseGlb(buffer) {
  if (buffer.length < 20 || buffer.toString('utf8', 0, 4) !== 'glTF') {
    throw new Error('Not a GLB 2.0 file.');
  }
  const version = readUInt32(buffer, 4);
  if (version !== 2) throw new Error(`Unsupported GLB version ${version}.`);

  let offset = 12;
  let json = null;
  let binaryLength = 0;
  while (offset + 8 <= buffer.length) {
    const chunkLength = readUInt32(buffer, offset);
    const chunkType = readUInt32(buffer, offset + 4);
    if (offset + 8 + chunkLength > buffer.length) throw new Error('Truncated GLB chunk.');
    if (chunkType === 0x4e4f534a) {
      json = JSON.parse(buffer.toString('utf8', offset + 8, offset + 8 + chunkLength).replace(/\0+$/, ''));
    } else if (chunkType === 0x004e4942) {
      binaryLength = chunkLength;
    }
    offset += 8 + chunkLength;
  }
  if (!json) throw new Error('GLB has no JSON chunk.');
  return { json, binaryLength };
}

function suggestComponents(name) {
  const lower = String(name ?? '').toLowerCase();
  const matches = [];
  for (const [component, keywords] of Object.entries(COMPONENT_KEYWORDS)) {
    if (keywords.some((keyword) => lower.includes(keyword))) matches.push(component);
  }
  return matches;
}

function summarizeAccessors(json) {
  return (json.accessors ?? []).map((accessor, index) => ({
    index,
    type: accessor.type ?? null,
    count: accessor.count ?? 0,
    min: Array.isArray(accessor.min) ? accessor.min : null,
    max: Array.isArray(accessor.max) ? accessor.max : null,
  }));
}

function inspect(filePath, buffer) {
  const { json, binaryLength } = parseGlb(buffer);
  const materials = new Map((json.materials ?? []).map((material, index) => [index, material.name ?? `material_${index}`]));
  const accessors = summarizeAccessors(json);

  const meshes = (json.meshes ?? []).map((mesh, meshIndex) => {
    const primitives = (mesh.primitives ?? []).map((primitive) => {
      const positionIndex = primitive.attributes?.POSITION;
      const position = positionIndex === undefined ? null : accessors[positionIndex] ?? null;
      const indices = primitive.indices === undefined ? null : accessors[primitive.indices] ?? null;
      return {
        material: primitive.material === undefined ? null : materials.get(primitive.material) ?? primitive.material,
        mode: primitive.mode ?? 4,
        vertices: position?.count ?? null,
        triangles: indices ? Math.floor(indices.count / 3) : position ? Math.floor(position.count / 3) : null,
        min: position?.min ?? null,
        max: position?.max ?? null,
      };
    });
    return {
      index: meshIndex,
      name: mesh.name ?? `mesh_${meshIndex}`,
      primitives,
    };
  });

  const meshNames = new Map(meshes.map((mesh) => [mesh.index, mesh.name]));
  const nodes = (json.nodes ?? []).map((node, index) => ({
    index,
    name: node.name ?? `node_${index}`,
    mesh: node.mesh === undefined ? null : meshNames.get(node.mesh) ?? node.mesh,
    children: Array.isArray(node.children) ? node.children.map((child) => json.nodes?.[child]?.name ?? `node_${child}`) : [],
    translation: Array.isArray(node.translation) ? node.translation : null,
    rotation: Array.isArray(node.rotation) ? node.rotation : null,
    scale: Array.isArray(node.scale) ? node.scale : null,
    possibleComponents: suggestComponents(node.name ?? meshNames.get(node.mesh)),
  }));

  const namedMatches = nodes
    .filter((node) => node.possibleComponents.length > 0)
    .map((node) => ({ node: node.name, components: node.possibleComponents }));

  return {
    file: relative(process.cwd(), filePath),
    bytes: buffer.length,
    binaryChunkBytes: binaryLength,
    generator: json.asset?.generator ?? null,
    copyright: json.asset?.copyright ?? json.asset?.license ?? null,
    extensionsUsed: json.extensionsUsed ?? [],
    extensionsRequired: json.extensionsRequired ?? [],
    sceneCount: json.scenes?.length ?? 0,
    nodeCount: nodes.length,
    meshCount: meshes.length,
    materialCount: json.materials?.length ?? 0,
    nodes,
    meshes,
    possibleComponentMatches: namedMatches,
    note: 'Keyword matches are review hints only. Only verified nodes may be added to vehicle_3d_assets.node_map_json.',
  };
}

const arguments_ = process.argv.slice(2);
const files = arguments_.length > 0
  ? arguments_
  : (await readdir(MODEL_DIRECTORY)).filter((name) => name.toLowerCase().endsWith('.glb')).map((name) => join(MODEL_DIRECTORY, name));

if (files.length === 0) {
  console.log('No GLB files found.');
} else {
  const reports = [];
  for (const filePath of files) {
    reports.push(inspect(filePath, await readFile(filePath)));
  }
  console.log(JSON.stringify(reports, null, 2));
}
