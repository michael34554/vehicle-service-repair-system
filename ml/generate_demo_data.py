"""Generate a clearly labelled synthetic demonstration training set.

The existing 48 curated symptom descriptions are retained as the diagnostic
text corpus. This script adds varied vehicle context so the model can accept
structured inputs, but the context values are assigned deterministically and
independently of the fault label: they are NOT evidence of a real correlation.
Never present the resulting evaluation as real-world diagnostic performance.
"""

from __future__ import annotations

import csv
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "data" / "vehicle_fault_symptoms.csv"
OUTPUT = ROOT / "data" / "vehicle_fault_training.csv"
SEED = 27
VARIANTS_PER_EXAMPLE = 8

MANUFACTURER_MODELS = [
    ("Toyota", "Corolla"), ("Toyota", "Camry"), ("Toyota", "Hilux"),
    ("Nissan", "Note"), ("Nissan", "X-Trail"), ("Volkswagen", "Golf"),
    ("Volkswagen", "Passat"), ("Mercedes-Benz", "C-Class"), ("Ford", "Focus"),
    ("Ford", "Ranger"), ("Honda", "Civic"), ("BMW", "3 Series"),
    ("Mazda", "3"), ("Hyundai", "Tucson"), ("Mitsubishi", "Outlander"),
]
ENGINES = [
    ("1.6 L petrol", "Petrol"), ("1.8 L petrol", "Petrol"),
    ("2.0 L diesel", "Diesel"), ("2.5 L petrol", "Petrol"),
    ("1.5 L turbo petrol", "Petrol"), ("Hybrid 1.8 L", "Hybrid"),
    ("2.2 L diesel", "Diesel"),
]
TRANSMISSIONS = ["Manual", "Automatic", "CVT", "Dual-clutch"]
DRIVES = ["FWD", "RWD", "AWD", "4WD"]
INSPECTIONS = [
    "No inspection recorded",
    "Visual check requested by the service advisor",
    "Battery load test recorded as normal",
    "Fluid levels checked",
    "No fault found on visual inspection",
    "Coolant level checked after engine cooled",
    "Brake pad thickness measured",
    "Wiring and connectors visually checked",
]
PREVIOUS_FAULTS = [
    "No previous fault recorded",
    "Previous battery replacement recorded",
    "Previous brake service recorded",
    "Prior catalyst-related code cleared",
    "Prior intake hose replacement recorded",
    "Previous thermostat replacement recorded",
]
COLUMNS = [
    "example_id", "symptom_text", "fault_category", "reference_dtc", "manufacturer", "model",
    "model_year", "engine_type", "mileage", "fuel_type", "transmission_type",
    "drive_type", "inspection_findings", "previous_faults", "provenance",
]


def main() -> None:
    with SOURCE.open(encoding="utf-8-sig", newline="") as source_file:
        examples = list(csv.DictReader(source_file))
    if not examples:
        raise SystemExit(f"No examples found in {SOURCE}.")

    random_generator = random.Random(SEED)
    seen: set[tuple[str, ...]] = set()
    rows: list[dict[str, str]] = []
    for index, example in enumerate(examples, start=1):
        example_id = f"ex-{index:03d}"
        for _ in range(VARIANTS_PER_EXAMPLE):
            make, model = random_generator.choice(MANUFACTURER_MODELS)
            engine, fuel = random_generator.choice(ENGINES)
            row = {
                "example_id": example_id,
                "symptom_text": (example.get("symptom_text") or "").strip(),
                "fault_category": (example.get("fault_category") or "").strip(),
                "reference_dtc": (example.get("reference_dtc") or "").strip(),
                "manufacturer": make,
                "model": model,
                "model_year": str(random_generator.randint(2008, 2024)),
                "engine_type": engine,
                "mileage": str(random_generator.randrange(15000, 225000, 5000)),
                "fuel_type": fuel,
                "transmission_type": random_generator.choice(TRANSMISSIONS),
                "drive_type": random_generator.choice(DRIVES),
                "inspection_findings": random_generator.choice(INSPECTIONS),
                "previous_faults": random_generator.choice(PREVIOUS_FAULTS),
                "provenance": "synthetic_demo",
            }
            key = tuple(row[column] for column in COLUMNS)
            if key in seen:
                continue
            seen.add(key)
            rows.append(row)

    with OUTPUT.open("w", encoding="utf-8", newline="") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} synthetic demonstration rows to {OUTPUT.relative_to(ROOT)}.")


if __name__ == "__main__":
    main()
