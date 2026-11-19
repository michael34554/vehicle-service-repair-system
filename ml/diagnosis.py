from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import accuracy_score, confusion_matrix, precision_recall_fscore_support
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline

ROOT = Path(__file__).resolve().parent
DATASET = ROOT / "data" / "vehicle_fault_symptoms.csv"
MODEL_PATH = ROOT / "vehicle_fault_model.joblib"
RANDOM_STATE = 27

# Static, curated guidance. It is attached to model output after inference; it is
# not used to generate the ranking and is not a claim that a cause was verified.
FAULT_GUIDANCE: dict[str, dict[str, Any]] = {
    "Engine misfire": {
        "dtc_reference": "P0300-P0304",
        "possible_causes": [
            "Worn spark plugs or ignition coils",
            "Fuel delivery restriction or low fuel pressure",
            "Mechanical compression or valve-sealing fault",
        ],
        "inspection_procedures": [
            "Scan for stored and pending codes and review freeze-frame data.",
            "Inspect spark plugs, ignition coils, and wiring for the affected cylinder(s).",
            "Check fuel delivery and perform compression or leak-down tests as indicated.",
        ],
    },
    "Lean air-fuel mixture": {
        "dtc_reference": "P0171 / P0174",
        "possible_causes": [
            "Unmetered air entering the intake after the mass-airflow sensor",
            "Low fuel pressure or a restricted fuel delivery component",
            "Contaminated or failing airflow or oxygen sensor",
        ],
        "inspection_procedures": [
            "Compare short- and long-term fuel trims at idle and raised rpm.",
            "Inspect intake ducting and vacuum connections; use an approved smoke test if needed.",
            "Verify MAF readings, fuel pressure, and oxygen-sensor response before replacing parts.",
        ],
    },
    "Cooling system temperature / thermostat": {
        "dtc_reference": "P0128",
        "possible_causes": [
            "Thermostat stuck open or opening below specification",
            "Coolant-temperature sensor or wiring error",
            "Cooling fan control or airflow restriction",
        ],
        "inspection_procedures": [
            "Check coolant level and inspect for leaks only after the engine has cooled.",
            "Compare coolant-temperature sensor readings with ambient temperature and a scan-tool warm-up trace.",
            "Verify thermostat operation and cooling-fan behavior against vehicle specifications.",
        ],
    },
    "Catalyst system efficiency": {
        "dtc_reference": "P0420 / P0430",
        "possible_causes": [
            "Underlying misfire or fuel-trim fault damaging the catalyst",
            "Exhaust leak upstream of an oxygen sensor",
            "Aging catalyst or oxygen-sensor response fault",
        ],
        "inspection_procedures": [
            "Check for exhaust leaks and resolve engine misfire or fuel-trim faults first.",
            "Compare upstream and downstream oxygen-sensor activity after the catalyst is fully warm.",
            "Confirm the result with manufacturer procedures before condemning the catalytic converter.",
        ],
    },
    "EVAP system leak": {
        "dtc_reference": "P0442 / P0455",
        "possible_causes": [
            "Loose, damaged, or missing fuel cap",
            "Cracked filler neck or evaporative hose",
            "Purge or vent valve not seating correctly",
        ],
        "inspection_procedures": [
            "Inspect the fuel cap, filler neck, and accessible EVAP hoses for damage or poor sealing.",
            "Run the manufacturer EVAP self-test and inspect purge and vent valve operation.",
            "Use an approved low-pressure smoke test; keep ignition sources away from fuel vapors.",
        ],
    },
    "Low system voltage / charging": {
        "dtc_reference": "P0562",
        "possible_causes": [
            "Discharged or failing battery",
            "Corroded or loose terminals, grounds, or charging wiring",
            "Alternator output or accessory belt fault",
        ],
        "inspection_procedures": [
            "Load-test the battery and inspect terminals and grounds for corrosion or looseness.",
            "Measure charging voltage and alternator output using the vehicle service procedure.",
            "Check the accessory belt, charging-system wiring, and relevant fuses before replacing components.",
        ],
    },
}


def load_dataset() -> tuple[list[str], list[str]]:
    texts: list[str] = []
    labels: list[str] = []
    with DATASET.open(encoding="utf-8-sig", newline="") as dataset_file:
        reader = csv.DictReader(dataset_file)
        required_columns = {"symptom_text", "fault_category", "reference_dtc"}
        if not required_columns.issubset(reader.fieldnames or []):
            raise ValueError(f"Dataset must contain columns: {', '.join(sorted(required_columns))}.")
        for row in reader:
            text = (row.get("symptom_text") or "").strip()
            label = (row.get("fault_category") or "").strip()
            if text and label:
                texts.append(text)
                labels.append(label)
    if len(set(labels)) < 2:
        raise ValueError("Training requires at least two fault categories.")
    if any(labels.count(label) < 4 for label in set(labels)):
        raise ValueError("Each fault category needs at least four labeled examples for a stratified holdout.")
    unknown = set(labels) - FAULT_GUIDANCE.keys()
    if unknown:
        raise ValueError(f"No inspection guidance is configured for: {', '.join(sorted(unknown))}.")
    return texts, labels


def create_model() -> Pipeline:
    return Pipeline(
        steps=[
            ("text", TfidfVectorizer(ngram_range=(1, 2), strip_accents="unicode", sublinear_tf=True)),
            (
                "classifier",
                RandomForestClassifier(
                    n_estimators=300,
                    min_samples_leaf=1,
                    class_weight="balanced",
                    random_state=RANDOM_STATE,
                    n_jobs=-1,
                ),
            ),
        ]
    )


def train() -> dict[str, Any]:
    texts, labels = load_dataset()
    train_texts, test_texts, train_labels, test_labels = train_test_split(
        texts,
        labels,
        test_size=0.25,
        random_state=RANDOM_STATE,
        stratify=labels,
    )
    evaluation_model = create_model()
    evaluation_model.fit(train_texts, train_labels)
    predictions = evaluation_model.predict(test_texts)
    precision, recall, f1, _ = precision_recall_fscore_support(
        test_labels,
        predictions,
        labels=sorted(set(labels)),
        average="weighted",
        zero_division=0,
    )
    report = {
        "dataset": str(DATASET.relative_to(ROOT)),
        "dataset_examples": len(texts),
        "categories": sorted(set(labels)),
        "evaluation": {
            "method": "stratified 75/25 holdout; random_state=27",
            "test_examples": len(test_labels),
            "accuracy": accuracy_score(test_labels, predictions),
            "weighted_precision": precision,
            "weighted_recall": recall,
            "weighted_f1": f1,
            "confusion_matrix_labels": sorted(set(labels)),
            "confusion_matrix": confusion_matrix(test_labels, predictions, labels=sorted(set(labels))).tolist(),
        },
        "data_limitations": "Curated starter examples mapped to OBD-II trouble-code descriptions; not verified workshop repair outcomes and not a measure of real-world diagnostic accuracy.",
    }
    production_model = create_model()
    production_model.fit(texts, labels)
    joblib.dump(production_model, MODEL_PATH)
    report["model_version"] = model_version()
    return report


def model_version() -> str:
    """Content-derived identifier so a saved diagnosis can name the exact model used."""
    digest = hashlib.sha256()
    digest.update(DATASET.read_bytes())
    digest.update(MODEL_PATH.read_bytes())
    return f"tfidf-rf-{digest.hexdigest()[:16]}"


def predict(payload: dict[str, Any]) -> dict[str, Any]:
    symptoms = payload.get("symptoms")
    if not isinstance(symptoms, str) or not 10 <= len(symptoms.strip()) <= 2000:
        raise ValueError("Symptoms must contain between 10 and 2000 characters.")
    if not MODEL_PATH.is_file():
        raise FileNotFoundError("Trained model is missing. Run: python ml/diagnosis.py train")
    model: Pipeline = joblib.load(MODEL_PATH)
    probabilities = model.predict_proba([symptoms.strip()])[0]
    if any(not math.isfinite(float(score)) for score in probabilities):
        raise ValueError("The diagnosis model returned a non-finite score.")
    classes = model.named_steps["classifier"].classes_
    ranked = sorted(zip(classes, probabilities), key=lambda item: float(item[1]), reverse=True)[:3]
    predictions = []
    for label, score in ranked:
        guidance = FAULT_GUIDANCE[str(label)]
        predictions.append(
            {
                "fault_category": str(label),
                "confidence": float(score),
                "dtc_reference": guidance["dtc_reference"],
                "possible_causes": guidance["possible_causes"],
                "inspection_procedures": guidance["inspection_procedures"],
            }
        )
    return {
        "predictions": predictions,
        "model": "TF-IDF + Random Forest trained from the bundled symptom corpus",
        "model_version": model_version(),
        "library_version": f"scikit-learn {sklearn.__version__}",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "warning": "AI suggestions are not a diagnosis. A qualified mechanic must inspect and verify the vehicle before repair decisions.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Train or query the NEXTGEN fault-classification model.")
    parser.add_argument("command", choices=("train", "predict"))
    args = parser.parse_args()
    try:
        result = train() if args.command == "train" else predict(json.load(sys.stdin))
        print(json.dumps(result, allow_nan=False))
    except Exception as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
