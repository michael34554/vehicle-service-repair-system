from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, confusion_matrix, precision_recall_fscore_support
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import MinMaxScaler, OneHotEncoder
from sklearn.tree import DecisionTreeClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.isotonic import IsotonicRegression

ROOT = Path(__file__).resolve().parent
DATASET = ROOT / "data" / "vehicle_fault_training.csv"
MODEL_PATH = ROOT / "vehicle_fault_model.joblib"
CALIBRATION_PATH = ROOT / "vehicle_fault_calibration.joblib"
EVALUATION_PATH = ROOT / "evaluation.json"
RANDOM_STATE = 27

TEXT_COLUMNS = ["symptom_text"]
CATEGORICAL_COLUMNS = [
    "manufacturer", "model", "engine_type", "fuel_type", "transmission_type",
    "drive_type", "inspection_findings", "previous_faults",
]
NUMERIC_COLUMNS = ["model_year", "mileage", "dtc_count"]
FEATURE_COLUMNS = TEXT_COLUMNS + CATEGORICAL_COLUMNS + NUMERIC_COLUMNS
TEXT_INDEX = 0
CATEGORICAL_INDICES = list(range(1, 1 + len(CATEGORICAL_COLUMNS)))
NUMERIC_INDICES = list(range(1 + len(CATEGORICAL_COLUMNS), len(FEATURE_COLUMNS)))
REQUIRED_COLUMNS = {
    "example_id", "symptom_text", "fault_category", "reference_dtc", "manufacturer", "model",
    "model_year", "engine_type", "mileage", "fuel_type", "transmission_type",
    "drive_type", "inspection_findings", "previous_faults", "provenance",
}
DTC_PATTERN = re.compile(r"\b[PBCU][0-9]{4}\b", re.IGNORECASE)

# Static, curated guidance attached after inference. It is not used to rank
# candidates and is not a claim that a cause was verified on a real vehicle.
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

PREDICTION_WARNING = (
    "AI suggestions are not a diagnosis. A qualified mechanic must inspect and verify the vehicle "
    "before repair decisions. Confidence values are calibrated estimates, not verified probabilities "
    "of component failure."
)
DATA_LIMITATIONS = (
    "The bundled training rows are synthetic demonstration data derived from 48 curated OBD-II symptom "
    "descriptions. Vehicle context (manufacturer, model, year, engine, mileage, fuel, transmission, drive, "
    "inspection findings and previous faults) is generated independently of the fault label, so it has no "
    "validated diagnostic signal. These results are not real-world workshop accuracy and must not be used "
    "as manufacturer failure statistics. Replace the corpus with mechanic-verified cases and retrain before "
    "operational use."
)

VERIFIED_DATA_LIMITATIONS = (
    "This model was retrained from a mixed corpus that includes mechanic-verified repair outcomes. "
    "Confidence values are isotonically calibrated on a grouped holdout, but they remain decision support "
    "and must be reviewed by a qualified mechanic. Report per-model metrics before trusting a vehicle class."
)


def guidance_for(label: str) -> dict[str, Any]:
    configured = FAULT_GUIDANCE.get(label)
    if configured:
        return configured
    return {
        "dtc_reference": "Verify with manufacturer diagnostic procedures",
        "possible_causes": [
            "Recorded verified repair outcome; root cause must be confirmed against workshop evidence",
        ],
        "inspection_procedures": [
            "Review the linked verified repair record and inspect the affected system before repair.",
            "Scan for stored DTCs and follow the manufacturer diagnostic procedure for the reported symptoms.",
        ],
    }


def calibration_curve(probabilities: list[list[float]], expected: list[str], classes: Any) -> IsotonicRegression:
    """Fit confidence calibration on a grouped holdout that was not used for this estimator."""
    pairs: list[tuple[float, int]] = []
    for row, actual in zip(probabilities, expected):
        top_index = max(range(len(row)), key=lambda index: float(row[index]))
        predicted = str(classes[top_index])
        pairs.append((float(row[top_index]), 1 if predicted == actual else 0))
    pairs.sort(key=lambda item: item[0])
    curve = IsotonicRegression(y_min=0.0, y_max=1.0, out_of_bounds="clip")
    curve.fit([item[0] for item in pairs], [item[1] for item in pairs])
    return curve


def calibrated_confidence(score: float) -> float:
    if not CALIBRATION_PATH.is_file():
        return float(score)
    curve: IsotonicRegression = joblib.load(CALIBRATION_PATH)
    return float(curve.predict([float(score)])[0])


def load_dataset(dataset_path: Path | None = None) -> tuple[list[dict[str, Any]], list[str], list[str], dict[str, int]]:
    dataset = dataset_path or DATASET
    if not dataset.is_file():
        raise FileNotFoundError(
            "Training dataset is missing. Run: python ml/generate_demo_data.py or "
            "node scripts/exportVerifiedTrainingData.mjs"
        )
    features: list[dict[str, Any]] = []
    labels: list[str] = []
    groups: list[str] = []
    provenance: dict[str, int] = {}
    with dataset.open(encoding="utf-8-sig", newline="") as dataset_file:
        reader = csv.DictReader(dataset_file)
        missing = REQUIRED_COLUMNS - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Dataset is missing columns: {', '.join(sorted(missing))}.")
        for row in reader:
            text = (row.get("symptom_text") or "").strip()
            label = (row.get("fault_category") or "").strip()
            group = (row.get("example_id") or "").strip()
            if not text or not label or not group:
                continue
            dtc = (row.get("reference_dtc") or "").strip()
            if dtc:
                text = f"{text}. Diagnostic reference: {dtc}."
            features.append({
                "symptom_text": text,
                **{column: (row.get(column) or "").strip() or "Not recorded" for column in CATEGORICAL_COLUMNS},
                "model_year": safe_int(row.get("model_year")),
                "mileage": safe_int(row.get("mileage")),
                "dtc_count": len(DTC_PATTERN.findall(dtc)),
                "provenance": (row.get("provenance") or "").strip(),
            })
            labels.append(label)
            groups.append(group)
            source = (row.get("provenance") or "").strip()
            provenance[source] = provenance.get(source, 0) + 1

    if len(set(labels)) < 2:
        raise ValueError("Training requires at least two fault categories.")
    minimum = min(labels.count(label) for label in set(labels))
    if minimum < 4:
        raise ValueError("Each fault category needs at least four labelled examples for a stratified holdout.")
    groups_by_label: dict[str, set[str]] = {}
    for label, group in zip(labels, groups):
        groups_by_label.setdefault(label, set()).add(group)
    if any(len(members) < 4 for members in groups_by_label.values()):
        raise ValueError("Each fault category needs at least four distinct source examples for a group-aware holdout.")
    group_labels: dict[str, set[str]] = {}
    for label, group in zip(labels, groups):
        group_labels.setdefault(group, set()).add(label)
    if any(len(members) != 1 for members in group_labels.values()):
        raise ValueError("A source example cannot have more than one fault category.")
    allowed_provenance = {"synthetic_demo", "verified_repair"}
    unexpected = set(provenance) - allowed_provenance
    if unexpected:
        raise ValueError(f"Unexpected dataset provenance: {', '.join(sorted(unexpected))}.")
    deduplicated = list(dict.fromkeys(
        (tuple(str(feature[column]) for column in FEATURE_COLUMNS), label)
        for feature, label in zip(features, labels)
    ))
    if len(deduplicated) != len(features):
        raise ValueError("Training dataset contains duplicate feature rows; remove them before training.")
    return features, labels, groups, provenance


def safe_int(value: Any) -> int:
    try:
        return int(float(str(value)))
    except (TypeError, ValueError):
        return 0


def as_matrix(features: list[dict[str, Any]]) -> list[list[Any]]:
    """Convert dict rows to an explicit matrix so column selection is unambiguous."""
    return [[row[column] for column in FEATURE_COLUMNS] for row in features]


def create_preprocessor() -> ColumnTransformer:
    return ColumnTransformer(
        transformers=[
            ("text", TfidfVectorizer(ngram_range=(1, 2), strip_accents="unicode", sublinear_tf=True), TEXT_INDEX),
            ("categorical", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL_INDICES),
            ("numeric", MinMaxScaler(), NUMERIC_INDICES),
        ],
        remainder="drop",
    )


def create_model(name: str) -> Pipeline:
    if name == "random_forest":
        classifier = RandomForestClassifier(
            n_estimators=300,
            min_samples_leaf=1,
            class_weight="balanced",
            random_state=RANDOM_STATE,
            n_jobs=-1,
        )
    elif name == "decision_tree":
        classifier = DecisionTreeClassifier(
            max_depth=8,
            class_weight="balanced",
            random_state=RANDOM_STATE,
        )
    elif name == "naive_bayes":
        classifier = MultinomialNB(alpha=0.5)
    else:
        raise ValueError(f"Unknown model: {name}")
    return Pipeline(steps=[("features", create_preprocessor()), ("classifier", classifier)])


def evaluate_model(name: str, train_features: list[dict[str, Any]], train_labels: list[str],
                   test_features: list[dict[str, Any]], test_labels: list[str], categories: list[str]) -> dict[str, Any]:
    model = create_model(name)
    model.fit(as_matrix(train_features), train_labels)
    predictions = model.predict(as_matrix(test_features))
    precision, recall, f1, _ = precision_recall_fscore_support(
        test_labels, predictions, labels=categories, average="weighted", zero_division=0
    )
    return {
        "model": name,
        "accuracy": float(accuracy_score(test_labels, predictions)),
        "weighted_precision": float(precision),
        "weighted_recall": float(recall),
        "weighted_f1": float(f1),
        "confusion_matrix_labels": categories,
        "confusion_matrix": confusion_matrix(test_labels, predictions, labels=categories).tolist(),
    }


def model_version(dataset_path: Path | None = None) -> str:
    digest = hashlib.sha256()
    for path in (dataset_path or DATASET, MODEL_PATH, CALIBRATION_PATH, Path(__file__)):
        if path.is_file():
            digest.update(path.read_bytes())
    return f"tfidf-rf-context-calibrated-{digest.hexdigest()[:16]}"


def train(dataset_path: Path | None = None) -> dict[str, Any]:
    dataset = dataset_path or DATASET
    features, labels, groups, provenance_counts = load_dataset(dataset)
    categories = sorted(set(labels))
    splitter = StratifiedGroupKFold(n_splits=4, shuffle=True, random_state=RANDOM_STATE)
    train_indices, test_indices = next(splitter.split(features, labels, groups))
    train_features = [features[index] for index in train_indices]
    test_features = [features[index] for index in test_indices]
    train_labels = [labels[index] for index in train_indices]
    test_labels = [labels[index] for index in test_indices]
    train_groups = {groups[index] for index in train_indices}
    test_groups = {groups[index] for index in test_indices}
    if train_groups & test_groups:
        raise ValueError("Group-aware split failed: source examples overlap between training and holdout.")
    evaluations = [
        evaluate_model(name, train_features, train_labels, test_features, test_labels, categories)
        for name in ("random_forest", "decision_tree", "naive_bayes")
    ]

    # Fit calibration only on the grouped holdout, never on the production training rows.
    holdout_model = create_model("random_forest")
    holdout_model.fit(as_matrix(train_features), train_labels)
    holdout_probabilities = holdout_model.predict_proba(as_matrix(test_features))
    calibration = calibration_curve(
        holdout_probabilities.tolist(),
        test_labels,
        holdout_model.named_steps["classifier"].classes_,
    )
    joblib.dump(calibration, CALIBRATION_PATH)

    holdout_predictions = holdout_model.predict(as_matrix(test_features))
    per_model: dict[str, dict[str, float | int]] = {}
    for feature, actual, predicted in zip(test_features, holdout_predictions, test_labels):
        key = f"{feature['manufacturer']} / {feature['model']}"
        record = per_model.setdefault(key, {"examples": 0, "correct": 0})
        record["examples"] = int(record["examples"]) + 1
        if str(predicted) == str(actual):
            record["correct"] = int(record["correct"]) + 1
    per_model_report = [
        {
            "manufacturer_model": key,
            "examples": int(values["examples"]),
            "accuracy": round(float(values["correct"]) / float(values["examples"]), 4),
        }
        for key, values in sorted(per_model.items())
    ]

    production_model = create_model("random_forest")
    production_model.fit(as_matrix(features), labels)
    joblib.dump(production_model, MODEL_PATH)

    has_verified = provenance_counts.get("verified_repair", 0) > 0
    report: dict[str, Any] = {
        "dataset": str(dataset.relative_to(ROOT)) if dataset.is_relative_to(ROOT) else str(dataset),
        "dataset_examples": len(features),
        "categories": categories,
        "provenance": "mixed_verified_and_synthetic" if has_verified else "synthetic_demo",
        "provenance_counts": provenance_counts,
        "structured_inputs": FEATURE_COLUMNS,
        "evaluation": {
            "method": "group-aware stratified holdout (StratifiedGroupKFold, 4 splits, first split, random_state=27) grouped by source symptom example; all preprocessing fitted inside each training pipeline",
            "leakage_check": {
                "train_source_examples": len(train_groups),
                "test_source_examples": len(test_groups),
                "overlapping_source_examples": len(train_groups & test_groups),
            },
            "train_examples": len(train_features),
            "test_examples": len(test_labels),
            "models": evaluations,
            "selected_model": "random_forest",
            "confidence_calibration": {
                "method": "isotonic regression on max holdout probability vs. correctness",
                "fitted_examples": len(test_labels),
                "artifact": CALIBRATION_PATH.name,
            },
            "per_model": per_model_report,
        },
        "data_limitations": VERIFIED_DATA_LIMITATIONS if has_verified else DATA_LIMITATIONS,
        "prediction_warning": PREDICTION_WARNING,
        "model_version": model_version(dataset),
        "library_version": f"scikit-learn {sklearn.__version__}",
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    EVALUATION_PATH.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return report


def context_text(payload: dict[str, Any], key: str, max_length: int = 120) -> str:
    value = payload.get(key, "Not recorded")
    if not isinstance(value, str):
        return "Not recorded"
    cleaned = value.strip().replace("\n", " ")
    return cleaned[:max_length] if cleaned else "Not recorded"


def extract_codes(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    codes: list[str] = []
    for item in value:
        if isinstance(item, str):
            codes.extend(match.group(0).upper() for match in DTC_PATTERN.finditer(item))
    return list(dict.fromkeys(codes))[:12]


def predict(payload: dict[str, Any]) -> dict[str, Any]:
    symptoms = payload.get("symptoms")
    if not isinstance(symptoms, str) or not 10 <= len(symptoms.strip()) <= 2000:
        raise ValueError("Symptoms must contain between 10 and 2000 characters.")
    if not MODEL_PATH.is_file():
        raise FileNotFoundError("Trained model is missing. Run: python ml/diagnosis.py train")

    context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
    dtc_codes = extract_codes(context.get("dtc_codes"))
    text = symptoms.strip()
    if dtc_codes:
        suffix = f" Diagnostic codes in workshop records: {', '.join(dtc_codes)}."
        text = f"{text[:max(1, 1800 - len(suffix))]}{suffix}"

    mileage = safe_int(context.get("mileage"))
    model_year = safe_int(context.get("model_year"))
    feature_row = {
        "symptom_text": text,
        "manufacturer": context_text(context, "manufacturer"),
        "model": context_text(context, "model"),
        "engine_type": context_text(context, "engine_type"),
        "fuel_type": context_text(context, "fuel_type"),
        "transmission_type": context_text(context, "transmission_type"),
        "drive_type": context_text(context, "drive_type"),
        "inspection_findings": context_text(context, "inspection_findings", 300),
        "previous_faults": context_text(context, "previous_faults", 300),
        "model_year": model_year if 1900 <= model_year <= 2100 else 0,
        "mileage": mileage if 0 <= mileage <= 2_000_000 else 0,
        "dtc_count": len(dtc_codes),
    }

    model: Pipeline = joblib.load(MODEL_PATH)
    matrix_row = [[feature_row[column] for column in FEATURE_COLUMNS]]
    probabilities = model.predict_proba(matrix_row)[0]
    if any(not math.isfinite(float(score)) for score in probabilities):
        raise ValueError("The diagnosis model returned a non-finite score.")
    classes = model.named_steps["classifier"].classes_
    ranked = sorted(
        ((str(label), calibrated_confidence(float(score))) for label, score in zip(classes, probabilities)),
        key=lambda item: item[1],
        reverse=True,
    )[:3]
    predictions = []
    for label, score in ranked:
        guidance = guidance_for(label)
        predictions.append({
            "fault_category": label,
            "confidence": score,
            "confidence_kind": "calibrated_estimate",
            "dtc_reference": guidance["dtc_reference"],
            "possible_causes": guidance["possible_causes"],
            "inspection_procedures": guidance["inspection_procedures"],
        })
    evaluation: dict[str, Any] = {}
    if EVALUATION_PATH.is_file():
        try:
            evaluation = json.loads(EVALUATION_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            evaluation = {}
    provenance = str(evaluation.get("provenance") or "unknown")
    return {
        "predictions": predictions,
        "model": f"TF-IDF + structured context + calibrated Random Forest ({provenance} corpus)",
        "model_version": evaluation.get("model_version") or model_version(),
        "library_version": f"scikit-learn {sklearn.__version__}",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "context_used": {
            "fields": FEATURE_COLUMNS,
            "dtc_codes": dtc_codes,
            "note": "Structured context is saved with the prediction. Signal quality depends on the provenance reported in evaluation.json.",
        },
        "warning": PREDICTION_WARNING,
        "data_limitations": evaluation.get("data_limitations") or DATA_LIMITATIONS,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Train or query the NEXTGEN fault-classification model.")
    parser.add_argument("command", choices=("train", "retrain", "predict"))
    parser.add_argument("--dataset", type=Path, help="Optional CSV dataset path for train/retrain.")
    args = parser.parse_args()
    try:
        if args.command in {"train", "retrain"}:
            result = train(args.dataset)
        else:
            result = predict(json.load(sys.stdin))
        summary = {
            key: value for key, value in result.items()
            if key not in {"confusion_matrix", "confusion_matrices"}
        } if args.command == "train" else result
        print(json.dumps(summary, allow_nan=False))
    except Exception as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
