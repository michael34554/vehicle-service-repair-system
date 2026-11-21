import type { db } from './db';
import { MECHANICAL_SYSTEMS, SMART_WORKSHOP_CONFIG, componentSystemKey, type ComponentKey } from '../shared/smartWorkshop';

/**
 * Idempotent reference-data seed for the Smart Workshop catalogue.
 *
 * Everything here is explicitly labelled. No model-specific technical
 * specification, failure rate or manufacturer-verified fault statistic is
 * invented. Model/asset links are representative because no manufacturer-
 * matched, licensed GLB is bundled with this repository.
 */

interface ManufacturerSeed {
  id: string;
  name: string;
  country: string;
  models: { id: string; name: string; body_style: string }[];
}

const MANUFACTURERS: ManufacturerSeed[] = [
  { id: 'toyota', name: 'Toyota', country: 'Japan', models: [
    { id: 'toyota-corolla', name: 'Corolla', body_style: 'Sedan' },
    { id: 'toyota-camry', name: 'Camry', body_style: 'Sedan' },
    { id: 'toyota-hilux', name: 'Hilux', body_style: 'Pickup' },
    { id: 'toyota-rav4', name: 'RAV4', body_style: 'SUV' },
    { id: 'toyota-yaris', name: 'Yaris', body_style: 'Hatchback' },
  ] },
  { id: 'nissan', name: 'Nissan', country: 'Japan', models: [
    { id: 'nissan-sunny', name: 'Sunny', body_style: 'Sedan' },
    { id: 'nissan-almera', name: 'Almera', body_style: 'Sedan' },
    { id: 'nissan-note', name: 'Note', body_style: 'Hatchback' },
    { id: 'nissan-navara', name: 'Navara', body_style: 'Pickup' },
    { id: 'nissan-x-trail', name: 'X-Trail', body_style: 'SUV' },
  ] },
  { id: 'volkswagen', name: 'Volkswagen', country: 'Germany', models: [
    { id: 'vw-golf', name: 'Golf', body_style: 'Hatchback' },
    { id: 'vw-polo', name: 'Polo', body_style: 'Hatchback' },
    { id: 'vw-passat', name: 'Passat', body_style: 'Sedan' },
    { id: 'vw-tiguan', name: 'Tiguan', body_style: 'SUV' },
  ] },
  { id: 'mercedes-benz', name: 'Mercedes-Benz', country: 'Germany', models: [
    { id: 'mercedes-c-class', name: 'C-Class', body_style: 'Sedan' },
    { id: 'mercedes-e-class', name: 'E-Class', body_style: 'Sedan' },
    { id: 'mercedes-glc', name: 'GLC', body_style: 'SUV' },
    { id: 'mercedes-a-class', name: 'A-Class', body_style: 'Hatchback' },
  ] },
  { id: 'ford', name: 'Ford', country: 'United States', models: [
    { id: 'ford-ranger', name: 'Ranger', body_style: 'Pickup' },
    { id: 'ford-focus', name: 'Focus', body_style: 'Hatchback' },
    { id: 'ford-everest', name: 'Everest', body_style: 'SUV' },
    { id: 'ford-fiesta', name: 'Fiesta', body_style: 'Hatchback' },
  ] },
  { id: 'honda', name: 'Honda', country: 'Japan', models: [
    { id: 'honda-civic', name: 'Civic', body_style: 'Sedan' },
    { id: 'honda-accord', name: 'Accord', body_style: 'Sedan' },
    { id: 'honda-cr-v', name: 'CR-V', body_style: 'SUV' },
    { id: 'honda-fit', name: 'Fit', body_style: 'Hatchback' },
  ] },
  { id: 'bmw', name: 'BMW', country: 'Germany', models: [
    { id: 'bmw-3-series', name: '3 Series', body_style: 'Sedan' },
    { id: 'bmw-5-series', name: '5 Series', body_style: 'Sedan' },
    { id: 'bmw-x3', name: 'X3', body_style: 'SUV' },
    { id: 'bmw-1-series', name: '1 Series', body_style: 'Hatchback' },
  ] },
  { id: 'mazda', name: 'Mazda', country: 'Japan', models: [
    { id: 'mazda-3', name: '3', body_style: 'Hatchback' },
    { id: 'mazda-6', name: '6', body_style: 'Sedan' },
    { id: 'mazda-cx-5', name: 'CX-5', body_style: 'SUV' },
    { id: 'mazda-mx-5', name: 'MX-5', body_style: 'Convertible' },
  ] },
  { id: 'hyundai', name: 'Hyundai', country: 'South Korea', models: [
    { id: 'hyundai-elantra', name: 'Elantra', body_style: 'Sedan' },
    { id: 'hyundai-tucson', name: 'Tucson', body_style: 'SUV' },
    { id: 'hyundai-santa-fe', name: 'Santa Fe', body_style: 'SUV' },
    { id: 'hyundai-i20', name: 'i20', body_style: 'Hatchback' },
  ] },
  { id: 'mitsubishi', name: 'Mitsubishi', country: 'Japan', models: [
    { id: 'mitsubishi-lancer', name: 'Lancer', body_style: 'Sedan' },
    { id: 'mitsubishi-outlander', name: 'Outlander', body_style: 'SUV' },
    { id: 'mitsubishi-pajero', name: 'Pajero', body_style: 'SUV' },
    { id: 'mitsubishi-triton', name: 'Triton', body_style: 'Pickup' },
  ] },
];

interface FaultSeed {
  id: string;
  manufacturer_id: string | null;
  model_id: string | null;
  year_from: number | null;
  year_to: number | null;
  engine_type: string | null;
  component_key: ComponentKey;
  fault_name: string;
  description: string;
  symptoms: string[];
  causes: string[];
  diagnostic_procedures: string[];
  dtc_codes: string[];
  recommended_inspection: string;
  corrective_action: string;
  dataset_source: string;
  provenance: 'sourced' | 'synthetic';
  fidelity_note: string;
  severity?: 'low' | 'medium' | 'high';
}

const GENERIC_SOURCE = 'General OBD-II diagnostic references and workshop inspection practice (generic, not manufacturer-specific)';
const SYNTHETIC_SOURCE = 'NEXTGEN synthetic demonstration dataset (illustrative only, not a verified workshop outcome)';
const GENERIC_NOTE = 'Generic diagnostic category. Applicability to a specific model, engine or model year must be confirmed against the vehicle and its service information.';
const SYNTHETIC_NOTE = 'Synthetic demonstration record. It is not evidence that this fault occurs on this model and must not be used as a failure statistic.';

const FAULTS: FaultSeed[] = [
  {
    id: 'fault-generic-misfire', manufacturer_id: null, model_id: null, year_from: null, year_to: null, engine_type: null,
    component_key: 'engine', fault_name: 'Engine misfire',
    description: 'One or more cylinders fail to complete normal combustion, commonly reported with a flashing or steady malfunction indicator lamp.',
    symptoms: ['Rough idle or vibration', 'Hesitation under acceleration', 'Flashing check engine light', 'Loss of power'],
    causes: ['Worn spark plugs or ignition coils', 'Fuel delivery restriction or low pressure', 'Mechanical compression or valve-sealing fault'],
    diagnostic_procedures: ['Scan stored and pending codes and freeze-frame data', 'Inspect plugs, coils and wiring on the affected cylinder', 'Check fuel delivery and perform compression or leak-down testing as indicated'],
    dtc_codes: ['P0300', 'P0301', 'P0302', 'P0303', 'P0304'],
    recommended_inspection: 'Identify the affected cylinder from codes and live misfire counters before replacing parts.',
    corrective_action: 'Rectify the confirmed cause and verify with a road test and code-clear cycle.',
    dataset_source: GENERIC_SOURCE, provenance: 'sourced', fidelity_note: GENERIC_NOTE, severity: 'high',
  },
  {
    id: 'fault-generic-lean', manufacturer_id: null, model_id: null, year_from: null, year_to: null, engine_type: null,
    component_key: 'fuel_system', fault_name: 'Lean air-fuel mixture',
    description: 'Measured air-fuel mixture is leaner than commanded, often with positive fuel trims and an airflow or oxygen-sensor code.',
    symptoms: ['Idle hunt or surge', 'Hissing sound near the intake', 'Hesitation on acceleration', 'Positive long-term fuel trims'],
    causes: ['Unmetered air entering the intake', 'Low fuel pressure or restricted delivery', 'Contaminated airflow or oxygen sensor'],
    diagnostic_procedures: ['Compare short- and long-term fuel trims at idle and raised rpm', 'Inspect intake ducting and vacuum connections', 'Verify airflow readings, fuel pressure and oxygen-sensor response'],
    dtc_codes: ['P0171', 'P0174'],
    recommended_inspection: 'Use an approved smoke test where available and inspect the intake after the airflow meter.',
    corrective_action: 'Repair the confirmed air or fuel delivery fault, then clear codes and recheck trims.',
    dataset_source: GENERIC_SOURCE, provenance: 'sourced', fidelity_note: GENERIC_NOTE, severity: 'medium',
  },
  {
    id: 'fault-generic-evap', manufacturer_id: null, model_id: null, year_from: null, year_to: null, engine_type: null,
    component_key: 'fuel_system', fault_name: 'EVAP system leak',
    description: 'Evaporative emission system fails a leak or purge test, usually reported with a fuel-cap or small/large leak code.',
    symptoms: ['Fuel odour near the vehicle', 'Check engine light after refuelling', 'Failed EVAP self-test'],
    causes: ['Loose, damaged or missing fuel cap', 'Cracked filler neck or evaporative hose', 'Purge or vent valve not seating'],
    diagnostic_procedures: ['Inspect fuel cap, filler neck and accessible hoses', 'Run the manufacturer EVAP self-test', 'Use an approved low-pressure smoke test away from ignition sources'],
    dtc_codes: ['P0442', 'P0455'],
    recommended_inspection: 'Check the fuel cap and filler neck first, then the purge and vent valves.',
    corrective_action: 'Seal or replace the confirmed leaking component and re-run the EVAP test.',
    dataset_source: GENERIC_SOURCE, provenance: 'sourced', fidelity_note: GENERIC_NOTE, severity: 'low',
  },
  {
    id: 'fault-generic-thermostat', manufacturer_id: null, model_id: null, year_from: null, year_to: null, engine_type: null,
    component_key: 'thermostat', fault_name: 'Thermostat stuck open',
    description: 'Coolant thermostat opens too early or never closes fully, producing a slow warm-up and low indicated temperature.',
    symptoms: ['Slow cabin warm-up', 'Temperature gauge remains low', 'Engine code for low coolant temperature', 'Poor heater output'],
    causes: ['Thermostat stuck open', 'Thermostat opening below specification', 'Coolant-temperature sensor or wiring error'],
    diagnostic_procedures: ['Compare scan-tool temperature with ambient temperature at start-up', 'Review a warm-up trace', 'Verify thermostat opening temperature against service information'],
    dtc_codes: ['P0128'],
    recommended_inspection: 'Confirm the warm-up trace before condemning the thermostat; rule out sensor and fan-control faults.',
    corrective_action: 'Replace a verified faulty thermostat and refill/bleed the cooling system using the specified procedure.',
    dataset_source: GENERIC_SOURCE, provenance: 'sourced', fidelity_note: GENERIC_NOTE, severity: 'medium',
  },
  {
    id: 'fault-generic-water-pump', manufacturer_id: null, model_id: null, year_from: null, year_to: null, engine_type: null,
    component_key: 'water_pump', fault_name: 'Water pump leakage or circulation failure',
    description: 'Coolant pump loses sealing or impeller efficiency, causing loss of circulation and possible overheating.',
    symptoms: ['Coolant loss without an obvious external leak', 'Overheating at idle or low speed', 'Bearing noise from the pump area', 'Coolant residue near the pump'],
    causes: ['Pump seal failure', 'Worn pump bearing or impeller', 'Incorrect or slipping pump drive'],
    diagnostic_procedures: ['Inspect the pump and weep hole after the engine cools', 'Verify circulation and temperature rise', 'Check drive belt tension and routing'],
    dtc_codes: [],
    recommended_inspection: 'Check the pump, drive and coolant condition together; never open a hot cooling system.',
    corrective_action: 'Replace a confirmed failed pump and renew coolant to the manufacturer specification.',
    dataset_source: GENERIC_SOURCE, provenance: 'sourced', fidelity_note: GENERIC_NOTE, severity: 'high',
  },
  {
    id: 'fault-generic-catalyst', manufacturer_id: null, model_id: null, year_from: null, year_to: null, engine_type: null,
    component_key: 'exhaust', fault_name: 'Catalyst system efficiency',
    description: 'Downstream oxygen-sensor activity indicates the catalytic converter is not storing oxygen as expected.',
    symptoms: ['Check engine light', 'Reduced performance', 'Sulphur smell or exhaust odour'],
    causes: ['Underlying misfire or fuel-trim fault damaging the catalyst', 'Exhaust leak upstream of an oxygen sensor', 'Aging catalyst or oxygen-sensor response fault'],
    diagnostic_procedures: ['Resolve engine misfire or fuel-trim faults first', 'Check for exhaust leaks', 'Compare upstream and downstream oxygen-sensor activity when fully warm'],
    dtc_codes: ['P0420', 'P0430'],
    recommended_inspection: 'Do not condemn the catalyst until engine faults and exhaust leaks are excluded.',
    corrective_action: 'Repair the root cause, then replace the catalyst only if the confirmed efficiency test still fails.',
    dataset_source: GENERIC_SOURCE, provenance: 'sourced', fidelity_note: GENERIC_NOTE, severity: 'medium',
  },
  {
    id: 'fault-generic-charging', manufacturer_id: null, model_id: null, year_from: null, year_to: null, engine_type: null,
    component_key: 'alternator', fault_name: 'Charging voltage low',
    description: 'Charging system cannot maintain system voltage under electrical load.',
    symptoms: ['Battery warning lamp', 'Slow cranking', 'Dim lights', 'Low measured charging voltage'],
    causes: ['Alternator output or regulator fault', 'Corroded terminals, grounds or charging wiring', 'Slipping or damaged accessory belt'],
    diagnostic_procedures: ['Load-test the battery', 'Measure charging voltage and alternator output', 'Inspect belt, wiring, fuses and grounds'],
    dtc_codes: ['P0562'],
    recommended_inspection: 'Test the battery and charging circuit as a system before replacing the alternator.',
    corrective_action: 'Repair the confirmed charging fault and verify voltage at idle and under load.',
    dataset_source: GENERIC_SOURCE, provenance: 'sourced', fidelity_note: GENERIC_NOTE, severity: 'medium',
  },
  {
    id: 'fault-generic-brakes', manufacturer_id: null, model_id: null, year_from: null, year_to: null, engine_type: null,
    component_key: 'brakes', fault_name: 'Brake pad and disc wear',
    description: 'Friction material or rotor wear beyond the service limit, sometimes with noise or vibration while braking.',
    symptoms: ['Squealing or grinding when braking', 'Longer stopping distance', 'Steering wheel vibration under braking'],
    causes: ['Normal friction-material wear', 'Caliper sticking or uneven pad loading', 'Corroded or warped disc'],
    diagnostic_procedures: ['Measure pad and disc thickness against specifications', 'Inspect caliper operation and slide pins', 'Check brake fluid condition and ABS codes'],
    dtc_codes: [],
    recommended_inspection: 'Inspect all four corners and compare left/right wear before quoting parts.',
    corrective_action: 'Renew worn friction and rotor components as a verified axle set and bed in according to the part instructions.',
    dataset_source: GENERIC_SOURCE, provenance: 'sourced', fidelity_note: GENERIC_NOTE, severity: 'high',
  },
  {
    id: 'fault-generic-ac', manufacturer_id: null, model_id: null, year_from: null, year_to: null, engine_type: null,
    component_key: 'air_conditioning', fault_name: 'Air conditioning poor cooling',
    description: 'Climate system fails to achieve expected cabin cooling; refrigerant charge and component operation must be measured.',
    symptoms: ['Warm air from vents', 'Long cool-down time', 'Compressor not engaging', 'Visible condenser damage'],
    causes: ['Low refrigerant charge from a leak', 'Compressor or control fault', 'Blocked condenser or evaporator airflow'],
    diagnostic_procedures: ['Verify vent temperatures with the engine running', 'Inspect compressor engagement and condenser airflow', 'Measure pressures using approved equipment and trace any leak'],
    dtc_codes: [],
    recommended_inspection: 'Confirm refrigerant charge and leak status before adding refrigerant.',
    corrective_action: 'Repair the confirmed fault, evacuate and recharge to the specified refrigerant mass.',
    dataset_source: GENERIC_SOURCE, provenance: 'sourced', fidelity_note: GENERIC_NOTE, severity: 'low',
  },
  {
    id: 'fault-toyota-corolla-catalyst', manufacturer_id: 'toyota', model_id: 'toyota-corolla', year_from: null, year_to: null, engine_type: null,
    component_key: 'exhaust', fault_name: 'Catalyst efficiency code after unresolved engine fault',
    description: 'Illustrative Corolla-linked record showing how an OBD catalyst code may follow an unresolved misfire or fuel-trim fault.',
    symptoms: ['Check engine light', 'Rough running before the code appeared'],
    causes: ['Unresolved engine misfire', 'Exhaust leak upstream of a sensor', 'Aging catalyst'],
    diagnostic_procedures: ['Check engine codes and trims first', 'Inspect exhaust integrity', 'Compare oxygen-sensor traces once warm'],
    dtc_codes: ['P0420'],
    recommended_inspection: 'Verify the model year and engine before assuming shared parts or procedures.',
    corrective_action: 'Correct the root cause and re-evaluate the catalyst before replacement.',
    dataset_source: SYNTHETIC_SOURCE, provenance: 'synthetic', fidelity_note: SYNTHETIC_NOTE, severity: 'medium',
  },
  {
    id: 'fault-nissan-note-thermostat', manufacturer_id: 'nissan', model_id: 'nissan-note', year_from: null, year_to: null, engine_type: null,
    component_key: 'thermostat', fault_name: 'Slow warm-up with low coolant temperature code',
    description: 'Illustrative Note-linked record for a low-temperature warm-up pattern; sensor and fan faults must be excluded.',
    symptoms: ['Weak cabin heat', 'Gauge stays low', 'P0128 stored'],
    causes: ['Thermostat opening early', 'Coolant-temperature sensor error', 'Cooling fan running continuously'],
    diagnostic_procedures: ['Log coolant temperature from cold start', 'Inspect thermostat and housing', 'Check fan command and sensor circuit'],
    dtc_codes: ['P0128'],
    recommended_inspection: 'Compare against the exact model-year service procedure before parts replacement.',
    corrective_action: 'Replace the thermostat only after the warm-up trace confirms the fault.',
    dataset_source: SYNTHETIC_SOURCE, provenance: 'synthetic', fidelity_note: SYNTHETIC_NOTE, severity: 'medium',
  },
  {
    id: 'fault-vw-golf-lean', manufacturer_id: 'volkswagen', model_id: 'vw-golf', year_from: null, year_to: null, engine_type: null,
    component_key: 'fuel_system', fault_name: 'Lean mixture and induction leak pattern',
    description: 'Illustrative Golf-linked record for positive fuel trims and induction leakage; engine variants differ.',
    symptoms: ['Idle instability', 'Hissing intake noise', 'P0171 stored'],
    causes: ['Air leak after the airflow meter', 'Low fuel pressure', 'Contaminated airflow sensor'],
    diagnostic_procedures: ['Read trims at idle and 2500 rpm', 'Inspect intake hoses and PCV connections', 'Verify fuel pressure and airflow readings'],
    dtc_codes: ['P0171'],
    recommended_inspection: 'Confirm the engine code because induction layouts vary between model years.',
    corrective_action: 'Repair the confirmed leak or delivery fault and recheck fuel trims.',
    dataset_source: SYNTHETIC_SOURCE, provenance: 'synthetic', fidelity_note: SYNTHETIC_NOTE, severity: 'medium',
  },
  {
    id: 'fault-mercedes-charging', manufacturer_id: 'mercedes-benz', model_id: 'mercedes-c-class', year_from: null, year_to: null, engine_type: null,
    component_key: 'battery', fault_name: 'Battery warning with low system voltage',
    description: 'Illustrative C-Class-linked record for a charging-system warning; battery monitoring and charging strategy vary by model.',
    symptoms: ['Battery warning message', 'Slow start', 'Electrical dimming'],
    causes: ['Discharged or failing battery', 'Charging circuit or regulator fault', 'Loose ground or terminal'],
    diagnostic_procedures: ['Load-test the battery', 'Inspect terminals and grounds', 'Measure charging output under load'],
    dtc_codes: ['P0562'],
    recommended_inspection: 'Follow the model-specific battery registration and charging test procedure where applicable.',
    corrective_action: 'Repair the confirmed battery or charging fault and clear stored warnings.',
    dataset_source: SYNTHETIC_SOURCE, provenance: 'synthetic', fidelity_note: SYNTHETIC_NOTE, severity: 'medium',
  },
  {
    id: 'fault-ford-ranger-cooling', manufacturer_id: 'ford', model_id: 'ford-ranger', year_from: null, year_to: null, engine_type: null,
    component_key: 'radiator', fault_name: 'Overheating with restricted radiator airflow',
    description: 'Illustrative Ranger-linked record for a restricted radiator or airflow path under load.',
    symptoms: ['Temperature rises under load', 'Poor heater output', 'Coolant loss after cooling'],
    causes: ['Blocked radiator core', 'Damaged shroud or fan operation', 'Low coolant level or wrong cap'],
    diagnostic_procedures: ['Inspect core and airflow path when cool', 'Check coolant level and cap', 'Verify fan operation and temperature trace'],
    dtc_codes: [],
    recommended_inspection: 'Confirm engine and cooling specification; never test a pressurized hot system.',
    corrective_action: 'Restore airflow and coolant integrity, then verify normal operating temperature.',
    dataset_source: SYNTHETIC_SOURCE, provenance: 'synthetic', fidelity_note: SYNTHETIC_NOTE, severity: 'high',
  },
  {
    id: 'fault-honda-civic-misfire', manufacturer_id: 'honda', model_id: 'honda-civic', year_from: null, year_to: null, engine_type: null,
    component_key: 'engine', fault_name: 'Cylinder misfire with flashing warning lamp',
    description: 'Illustrative Civic-linked record for a misfire pattern; ignition and fuel systems vary by engine variant.',
    symptoms: ['Engine vibration', 'Flashing check engine light', 'Hesitation'],
    causes: ['Ignition coil or plug fault', 'Fuel injector restriction', 'Compression fault'],
    diagnostic_procedures: ['Read cylinder-specific codes and counters', 'Inspect ignition components', 'Check fuel and compression when indicated'],
    dtc_codes: ['P0301', 'P0302', 'P0303', 'P0304'],
    recommended_inspection: 'Do not drive with a flashing warning lamp; confirm the affected cylinder first.',
    corrective_action: 'Correct the verified cause and recheck misfire counters after repair.',
    dataset_source: SYNTHETIC_SOURCE, provenance: 'synthetic', fidelity_note: SYNTHETIC_NOTE, severity: 'high',
  },
  {
    id: 'fault-bmw-3-cooling', manufacturer_id: 'bmw', model_id: 'bmw-3-series', year_from: null, year_to: null, engine_type: null,
    component_key: 'water_pump', fault_name: 'Coolant loss from pump or cooling circuit',
    description: 'Illustrative 3 Series-linked record for coolant loss around the pump area; pump design varies widely by engine.',
    symptoms: ['Coolant warning', 'Temperature rise in traffic', 'Coolant residue under the vehicle'],
    causes: ['Pump seal or housing leak', 'Hose or fitting leak', 'Cooling system overpressure'],
    diagnostic_procedures: ['Inspect the cooled engine and pump area', 'Pressure-test the cooling system', 'Check coolant condition and cap'],
    dtc_codes: [],
    recommended_inspection: 'Use the exact engine-specific procedure and coolant specification.',
    corrective_action: 'Repair the confirmed leak and bleed the cooling system correctly.',
    dataset_source: SYNTHETIC_SOURCE, provenance: 'synthetic', fidelity_note: SYNTHETIC_NOTE, severity: 'high',
  },
  {
    id: 'fault-mazda-3-brakes', manufacturer_id: 'mazda', model_id: 'mazda-3', year_from: null, year_to: null, engine_type: null,
    component_key: 'brakes', fault_name: 'Front brake noise and uneven pad wear',
    description: 'Illustrative Mazda 3-linked record for friction wear and caliper slide issues.',
    symptoms: ['Squeal when braking', 'Uneven pad wear', 'Pulling under braking'],
    causes: ['Sticking caliper slide', 'Worn pads or discs', 'Contaminated friction surfaces'],
    diagnostic_procedures: ['Measure pad and disc thickness', 'Inspect caliper movement', 'Check tyre pressures and alignment'],
    dtc_codes: [],
    recommended_inspection: 'Compare left and right wear and inspect the hydraulic circuit.',
    corrective_action: 'Service or renew the verified braking components and verify braking balance.',
    dataset_source: SYNTHETIC_SOURCE, provenance: 'synthetic', fidelity_note: SYNTHETIC_NOTE, severity: 'high',
  },
  {
    id: 'fault-hyundai-tucson-ac', manufacturer_id: 'hyundai', model_id: 'hyundai-tucson', year_from: null, year_to: null, engine_type: null,
    component_key: 'air_conditioning', fault_name: 'Air conditioning not reaching set temperature',
    description: 'Illustrative Tucson-linked record for reduced cooling performance; refrigerant type and charge mass vary by year.',
    symptoms: ['Warm vent air', 'Compressor cycling frequently', 'Fogging windscreen'],
    causes: ['Refrigerant leak', 'Blocked condenser', 'Climate control sensor or actuator fault'],
    diagnostic_procedures: ['Measure vent temperature', 'Inspect condenser and compressor', 'Use approved leak detection and pressure testing'],
    dtc_codes: [],
    recommended_inspection: 'Confirm refrigerant specification from the vehicle label before any service.',
    corrective_action: 'Repair the confirmed fault and recharge to the specified mass.',
    dataset_source: SYNTHETIC_SOURCE, provenance: 'synthetic', fidelity_note: SYNTHETIC_NOTE, severity: 'low',
  },
  {
    id: 'fault-mitsubishi-triton-exhaust', manufacturer_id: 'mitsubishi', model_id: 'mitsubishi-triton', year_from: null, year_to: null, engine_type: null,
    component_key: 'exhaust', fault_name: 'Exhaust leak with oxygen-sensor code',
    description: 'Illustrative Triton-linked record for an exhaust leak affecting sensor readings.',
    symptoms: ['Exhaust noise', 'Check engine light', 'Poor fuel Economy'],
    causes: ['Corroded pipe or joint', 'Loose flange or gasket', 'Sensor thread leak'],
    diagnostic_procedures: ['Inspect pipework and joints with the engine cool', 'Review oxygen-sensor live data', 'Check for stored sensor codes'],
    dtc_codes: ['P0130'],
    recommended_inspection: 'Confirm engine and exhaust layout before sourcing parts.',
    corrective_action: 'Repair the verified leak and recheck codes after a warm-up cycle.',
    dataset_source: SYNTHETIC_SOURCE, provenance: 'synthetic', fidelity_note: SYNTHETIC_NOTE, severity: 'medium',
  },
  {
    id: 'fault-nissan-x-trail-suspension', manufacturer_id: 'nissan', model_id: 'nissan-x-trail', year_from: null, year_to: null, engine_type: null,
    component_key: 'front_suspension', fault_name: 'Front suspension play and uneven tyre wear',
    description: 'Illustrative X-Trail-linked record for worn suspension linkages and resulting tyre wear.',
    symptoms: ['Clunk over bumps', 'Uneven front tyre wear', 'Wandering steering'],
    causes: ['Worn ball joint or tie-rod end', 'Degraded bushing', 'Leaking strut'],
    diagnostic_procedures: ['Perform a suspension play inspection', 'Inspect struts and linkages', 'Check tyre tread pattern and pressures'],
    dtc_codes: [],
    recommended_inspection: 'Inspect the whole front axle before replacing individual parts.',
    corrective_action: 'Renew verified worn components and perform an alignment afterwards.',
    dataset_source: SYNTHETIC_SOURCE, provenance: 'synthetic', fidelity_note: SYNTHETIC_NOTE, severity: 'medium',
  },
  {
    id: 'fault-toyota-hilux-wheels', manufacturer_id: 'toyota', model_id: 'toyota-hilux', year_from: null, year_to: null, engine_type: null,
    component_key: 'wheels_tyres', fault_name: 'Wheel bearing noise with vibration',
    description: 'Illustrative Hilux-linked record for wheel-bearing wear; bearing and hub arrangements differ by variant.',
    symptoms: ['Humming or growling from a wheel', 'Vibration at speed', 'Uneven tyre wear'],
    causes: ['Worn wheel bearing', 'Loose hub or damaged rim', 'Tyre imbalance'],
    diagnostic_procedures: ['Check hub play with the wheel raised', 'Road-test at steady speeds', 'Inspect tyres and rims'],
    dtc_codes: [],
    recommended_inspection: 'Identify the affected corner before disassembly and confirm wheel torque.',
    corrective_action: 'Replace the verified bearing or hub and recheck wheel alignment where required.',
    dataset_source: SYNTHETIC_SOURCE, provenance: 'synthetic', fidelity_note: SYNTHETIC_NOTE, severity: 'medium',
  },
  {
    id: 'fault-ford-focus-electrical', manufacturer_id: 'ford', model_id: 'ford-focus', year_from: null, year_to: null, engine_type: null,
    component_key: 'electrical_system', fault_name: 'Intermittent warning lamp with stored module code',
    description: 'Illustrative Focus-linked record for an electrical or control-module warning pattern.',
    symptoms: ['Intermittent warning lamp', 'Accessory malfunction', 'Stored code in a control module'],
    causes: ['Loose connector or ground', 'Low battery voltage affecting modules', 'Failing sensor or actuator'],
    diagnostic_procedures: ['Scan all modules and record codes', 'Check battery voltage and grounds', 'Inspect relevant wiring and connectors'],
    dtc_codes: [],
    recommended_inspection: 'Record the exact code and freeze-frame data before clearing anything.',
    corrective_action: 'Repair the verified electrical fault and confirm the warning does not return.',
    dataset_source: SYNTHETIC_SOURCE, provenance: 'synthetic', fidelity_note: SYNTHETIC_NOTE, severity: 'low',
  },
];

export interface CatalogueSeedResult {
  manufacturers: number;
  models: number;
  systems: number;
  components: number;
  faults: number;
}

/** Safe to call on every server start: all inserts use INSERT IGNORE. */
export async function seedSmartWorkshopCatalogue(database: typeof db): Promise<CatalogueSeedResult> {
  const now = new Date().toISOString();
  const genericAssetKey = 'generic-licensed-vehicle';
  const nodeMap = Object.fromEntries(
    SMART_WORKSHOP_CONFIG.components.flatMap((component) => component.exteriorNodes.map((node) => [node, component.key]))
  );

  await database.execute(`
    INSERT IGNORE INTO vehicle_3d_assets
      (asset_key, label, model_path, license, license_url, source, is_generic, is_exact_match, node_map_json, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, genericAssetKey,
    'Generic licensed illustration (Ferrari 458 Italia)',
    '/assets/models/ferrari.glb',
    'CC BY 4.0',
    'https://creativecommons.org/licenses/by/4.0/',
    'Ferrari 458 Italia model by vicent091036, distributed as the three.js example ferrari.glb',
    1, 0, JSON.stringify(nodeMap),
    'Representative vehicle body only. It is NOT an exact model of any manufacturer in this catalogue. Interior and mechanical groups are procedural assemblies.',
    now, now);

  for (const system of MECHANICAL_SYSTEMS) {
    await database.execute(`
      INSERT IGNORE INTO mechanical_systems (system_key, label, description, sort_order)
      VALUES (?, ?, ?, ?)
    `, system.key, system.label, system.description, MECHANICAL_SYSTEMS.indexOf(system));
  }

  for (const [index, component] of SMART_WORKSHOP_CONFIG.components.entries()) {
    await database.execute(`
      INSERT IGNORE INTO vehicle_components
        (component_key, system_key, label, description, model_node_hint, is_exact_node, inspection_focus_json, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, component.key, component.system_key, component.label, component.description,
      component.exteriorNodes[0] ?? null, component.exteriorNodes.length > 0 ? 1 : 0,
      JSON.stringify(component.inspectionFocus), index);
  }

  for (const manufacturer of MANUFACTURERS) {
    await database.execute(`
      INSERT IGNORE INTO vehicle_manufacturers (id, name, country, is_active, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `, manufacturer.id, manufacturer.name, manufacturer.country, now, now);
    for (const model of manufacturer.models) {
      await database.execute(`
        INSERT IGNORE INTO vehicle_models
          (id, manufacturer_id, name, body_style, image_path, asset_key, asset_status, specification_note, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, NULL, ?, 'representative', ?, 1, ?, ?)
      `, model.id, manufacturer.id, model.name, model.body_style, genericAssetKey,
        'No verified technical specifications are recorded for this catalogue entry. Confirm engine, fuel, transmission and drive details against the vehicle or manufacturer service information before use.',
        now, now);
      await database.execute(`
        INSERT IGNORE INTO vehicle_specifications
          (id, model_id, year_from, year_to, engine_type, engine_capacity_cc, fuel_type, transmission_type,
           drive_type, technical_specs_json, data_source, verification_status, created_at, updated_at)
        VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, 'not_recorded', ?, ?)
      `, `spec-${model.id}`, model.id,
        'No verified specification supplied; add from the vehicle service book or manufacturer data.', now, now);
      for (const system of MECHANICAL_SYSTEMS) {
        await database.execute(`
          INSERT IGNORE INTO vehicle_model_systems (model_id, system_key) VALUES (?, ?)
        `, model.id, system.key);
      }
    }
  }

  for (const fault of FAULTS) {
    await database.execute(`
      INSERT IGNORE INTO vehicle_fault_records
        (id, manufacturer_id, model_id, year_from, year_to, engine_type, system_key, component_key,
         fault_name, description, symptoms_json, causes_json, diagnostic_procedures_json, dtc_codes_json,
         recommended_inspection, corrective_action, dataset_source, provenance, fidelity_note, severity,
         is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `, fault.id, fault.manufacturer_id, fault.model_id, fault.year_from, fault.year_to, fault.engine_type,
      componentSystemKey(fault.component_key), fault.component_key, fault.fault_name, fault.description,
      JSON.stringify(fault.symptoms), JSON.stringify(fault.causes), JSON.stringify(fault.diagnostic_procedures),
      JSON.stringify(fault.dtc_codes), fault.recommended_inspection, fault.corrective_action,
      fault.dataset_source, fault.provenance, fault.fidelity_note, fault.severity ?? null, now, now);
  }

  return {
    manufacturers: MANUFACTURERS.length,
    models: MANUFACTURERS.reduce((total, entry) => total + entry.models.length, 0),
    systems: MECHANICAL_SYSTEMS.length,
    components: SMART_WORKSHOP_CONFIG.components.length,
    faults: FAULTS.length,
  };
}
