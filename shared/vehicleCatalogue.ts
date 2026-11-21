/**
 * Browser-safe central catalogue of the vehicle makes and models the Smart Workshop
 * can select. The database remains the source of truth for registered vehicles;
 * this module supplies the initial expandable catalogue and the canonical mapping
 * from a vehicle identity to its 3D asset path.
 *
 * An entry here does not imply that the GLB file exists. Availability is checked
 * against the filesystem by the server and surfaced to the viewer at runtime.
 */

export interface CatalogueManufacturer {
  key: string;
  name: string;
  aliases?: readonly string[];
}

export interface CatalogueModel {
  id: string;
  manufacturer: string;
  name: string;
  assetKey: string;
  assetPath: string;
  /** Years/variants/engines are populated from real catalogue or registered-vehicle data. */
  years: readonly number[];
  variants: readonly string[];
  engines: readonly string[];
}

export const GENERIC_DEMO_ASSET_KEY = 'generic-licensed-vehicle';
export const GENERIC_DEMO_ASSET_PATH = '/assets/models/ferrari.glb';

export const VEHICLE_MANUFACTURERS: readonly CatalogueManufacturer[] = [
  { key: 'toyota', name: 'Toyota' },
  { key: 'nissan', name: 'Nissan' },
  { key: 'volkswagen', name: 'Volkswagen', aliases: ['vw'] },
  { key: 'mercedes-benz', name: 'Mercedes-Benz', aliases: ['mercedes', 'mercedes benz'] },
  { key: 'ford', name: 'Ford' },
  { key: 'honda', name: 'Honda' },
  { key: 'bmw', name: 'BMW' },
  { key: 'mazda', name: 'Mazda' },
  { key: 'hyundai', name: 'Hyundai' },
  { key: 'mitsubishi', name: 'Mitsubishi' },
  { key: 'suzuki', name: 'Suzuki' },
];


interface ModelSeed {
  manufacturer: string;
  name: string;
  modelSlug: string;
  /** Retains existing database IDs where historical fault records already use them. */
  id?: string;
}

const MODEL_SEEDS: readonly ModelSeed[] = [
  { manufacturer: 'toyota', name: 'Corolla', modelSlug: 'corolla' },
  { manufacturer: 'toyota', name: 'Camry', modelSlug: 'camry' },
  { manufacturer: 'toyota', name: 'Hilux', modelSlug: 'hilux' },
  { manufacturer: 'toyota', name: 'Land Cruiser', modelSlug: 'land-cruiser' },
  { manufacturer: 'toyota', name: 'RAV4', modelSlug: 'rav4' },
  { manufacturer: 'toyota', name: 'Vitz', modelSlug: 'vitz' },
  { manufacturer: 'nissan', name: 'Sunny', modelSlug: 'sunny' },
  { manufacturer: 'nissan', name: 'Note', modelSlug: 'note' },
  { manufacturer: 'nissan', name: 'X-Trail', modelSlug: 'x-trail' },
  { manufacturer: 'nissan', name: 'Navara', modelSlug: 'navara' },
  { manufacturer: 'nissan', name: 'Patrol', modelSlug: 'patrol' },
  { manufacturer: 'nissan', name: 'March', modelSlug: 'march' },
  { manufacturer: 'volkswagen', name: 'Golf', modelSlug: 'golf', id: 'vw-golf' },
  { manufacturer: 'volkswagen', name: 'Polo', modelSlug: 'polo', id: 'vw-polo' },
  { manufacturer: 'volkswagen', name: 'Passat', modelSlug: 'passat', id: 'vw-passat' },
  { manufacturer: 'volkswagen', name: 'Tiguan', modelSlug: 'tiguan', id: 'vw-tiguan' },
  { manufacturer: 'mercedes-benz', name: 'C-Class', modelSlug: 'c-class', id: 'mercedes-c-class' },
  { manufacturer: 'mercedes-benz', name: 'E-Class', modelSlug: 'e-class', id: 'mercedes-e-class' },
  { manufacturer: 'mercedes-benz', name: 'S-Class', modelSlug: 's-class', id: 'mercedes-s-class' },
  { manufacturer: 'mercedes-benz', name: 'GLE', modelSlug: 'gle', id: 'mercedes-gle' },
  { manufacturer: 'mercedes-benz', name: 'Sprinter', modelSlug: 'sprinter', id: 'mercedes-sprinter' },
  { manufacturer: 'ford', name: 'Ranger', modelSlug: 'ranger' },
  { manufacturer: 'ford', name: 'Focus', modelSlug: 'focus' },
  { manufacturer: 'ford', name: 'Everest', modelSlug: 'everest' },
  { manufacturer: 'ford', name: 'Mustang', modelSlug: 'mustang' },
];

export const VEHICLE_MODELS: readonly CatalogueModel[] = MODEL_SEEDS.map((seed) => {
  const id = seed.id ?? `${seed.manufacturer}-${seed.modelSlug}`;
  return {
    id,
    manufacturer: seed.manufacturer,
    name: seed.name,
    assetKey: id,
    assetPath: `/assets/models/${seed.manufacturer}/${seed.modelSlug}.glb`,
    years: [],
    variants: [],
    engines: [],
  };
});

const MANUFACTURER_ALIASES: ReadonlyMap<string, string> = new Map(
  VEHICLE_MANUFACTURERS.flatMap((manufacturer) => [
    [normalise(manufacturer.name), manufacturer.key],
    [normalise(manufacturer.key), manufacturer.key],
    ...(manufacturer.aliases ?? []).map((alias) => [normalise(alias), manufacturer.key] as const),
  ])
);

function normalise(value: string): string {
  return value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const MODEL_LOOKUP: ReadonlyMap<string, CatalogueModel> = new Map(
  VEHICLE_MODELS.map((model) => [normalise(`${model.manufacturer} ${model.name}`), model])
);

export function catalogueModelByAssetKey(assetKey: string | null | undefined): CatalogueModel | undefined {
  if (!assetKey) return undefined;
  return VEHICLE_MODELS.find((model) => model.assetKey === assetKey || model.id === assetKey);
}

export function resolveCatalogueModel(make: string, model: string): CatalogueModel | undefined {
  const manufacturer = MANUFACTURER_ALIASES.get(normalise(make)) ?? normalise(make);
  return MODEL_LOOKUP.get(normalise(`${manufacturer} ${model}`));
}

export function assetPathForModel(assetKey: string | null | undefined): string | null {
  return catalogueModelByAssetKey(assetKey)?.assetPath ?? null;
}
