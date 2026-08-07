#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
import sys

from jsonschema import Draft202012Validator
from referencing import Registry, Resource


ROOT = Path(__file__).resolve().parent.parent
SCHEMA_DIRECTORY = ROOT / "schemas"
PROOF_INPUT_DIRECTORY = ROOT / "dist" / "vox-phase2-proof" / "inputs"
LOOPING_WORLD_INPUT_DIRECTORY = (
    ROOT / "dist" / "vox-looping-world-proof" / "inputs"
)
ASSET_HARDENING_INPUT_DIRECTORY = (
    ROOT
    / "dist"
    / "vox-phase2-proof"
    / "asset-hardening"
    / "registered-family"
    / "inputs"
)
CANONICAL_CONTAINER_FIXTURE_DIRECTORY = (
    ROOT / "fixtures" / "canonical-container"
)
REGISTERED_GEOMETRY_INPUT_DIRECTORY = (
    ROOT / "dist" / "vox-phase2-proof" / "inputs"
)


def load_json(file: Path) -> dict:
    return json.loads(file.read_text(encoding="utf-8"))


schemas = {
    file.name: load_json(file)
    for file in sorted(SCHEMA_DIRECTORY.glob("*.schema.json"))
}
registry = Registry()
for name, schema in schemas.items():
    Draft202012Validator.check_schema(schema)
    if "$id" in schema:
        registry = registry.with_resource(
            schema["$id"],
            Resource.from_contents(schema),
        )
    registry = registry.with_resource(
        f"https://local.paper-collage.dev/{name}",
        Resource.from_contents(schema),
    )


def validate(instance_file: Path, schema_name: str) -> None:
    schema = schemas[schema_name]
    validator = Draft202012Validator(schema, registry=registry)
    errors = sorted(
        validator.iter_errors(load_json(instance_file)),
        key=lambda error: list(error.absolute_path),
    )
    if errors:
        rendered = "\n".join(
            f"{instance_file.relative_to(ROOT)}:{'/'.join(map(str, error.absolute_path))}: {error.message}"
            for error in errors
        )
        raise ValueError(rendered)


def validate_ref(
    instance_file: Path,
    schema_name: str,
    fragment: str,
) -> None:
    validator = Draft202012Validator(
        {
            "$ref": (
                f"https://local.paper-collage.dev/{schema_name}"
                f"#{fragment}"
            )
        },
        registry=registry,
    )
    errors = sorted(
        validator.iter_errors(load_json(instance_file)),
        key=lambda error: list(error.absolute_path),
    )
    if errors:
        rendered = "\n".join(
            f"{instance_file.relative_to(ROOT)}:{'/'.join(map(str, error.absolute_path))}: {error.message}"
            for error in errors
        )
        raise ValueError(rendered)


def validate_ref_instance(
    instance: dict,
    schema_name: str,
    fragment: str,
    label: str,
) -> None:
    validator = Draft202012Validator(
        {
            "$ref": (
                f"https://local.paper-collage.dev/{schema_name}"
                f"#{fragment}"
            )
        },
        registry=registry,
    )
    errors = sorted(
        validator.iter_errors(instance),
        key=lambda error: list(error.absolute_path),
    )
    if errors:
        rendered = "\n".join(
            f"{label}:{'/'.join(map(str, error.absolute_path))}: {error.message}"
            for error in errors
        )
        raise ValueError(rendered)


def treatment_with_motion(motion: dict) -> dict:
    return {
        "id": "schema-cycle-proof",
        "targetId": "traveler",
        "importance": "hero",
        "necessity": "required",
        "changeClass": (
            "pose-change"
            if motion["kind"] == "state-sequence"
            else "decorative-field"
        ),
        "motion": motion,
        "composition": {"pattern": "free"},
        "graphic": None,
        "semanticRisk": "decorative",
        "proofTimeId": None,
        "rationale": "Schema proof for primitive-specific cycle bounds.",
    }


try:
    validate(
        PROOF_INPUT_DIRECTORY / "storyboard-authoring.json",
        "storyboard-authoring.schema.json",
    )
    validate(PROOF_INPUT_DIRECTORY / "storyboard.json", "storyboard.schema.json")
    for project in sorted(PROOF_INPUT_DIRECTORY.glob("project-*.json")):
        validate(project, "project.schema.json")
    validate(
        PROOF_INPUT_DIRECTORY / "assets-manifest.json",
        "assets-manifest.schema.json",
    )
    validate(
        LOOPING_WORLD_INPUT_DIRECTORY / "storyboard-authoring.json",
        "storyboard-authoring.schema.json",
    )
    validate(
        LOOPING_WORLD_INPUT_DIRECTORY / "storyboard.json",
        "storyboard.schema.json",
    )
    for project in sorted(LOOPING_WORLD_INPUT_DIRECTORY.glob("project-*.json")):
        validate(project, "project.schema.json")
    validate(
        LOOPING_WORLD_INPUT_DIRECTORY / "assets-manifest.json",
        "assets-manifest.schema.json",
    )
    for derivation in sorted(
        LOOPING_WORLD_INPUT_DIRECTORY.glob("*-derivation.json")
    ):
        validate(derivation, "looping-strip.schema.json")
    validate(
        ASSET_HARDENING_INPUT_DIRECTORY / "registered-family.json",
        "registered-family.schema.json",
    )
    validate(
        ASSET_HARDENING_INPUT_DIRECTORY / "rejected-output-recovery.json",
        "rejected-output-recovery.schema.json",
    )
    validate(
        CANONICAL_CONTAINER_FIXTURE_DIRECTORY
        / "canonical-container.json",
        "canonical-container.schema.json",
    )
    validate(
        CANONICAL_CONTAINER_FIXTURE_DIRECTORY
        / "canonical-container-binding.json",
        "canonical-container-binding.schema.json",
    )
    registered_geometry_input = (
        REGISTERED_GEOMETRY_INPUT_DIRECTORY / "registered-geometry-proof.json"
    )
    if registered_geometry_input.exists():
        validate(
            registered_geometry_input,
            "registered-geometry-proof.schema.json",
        )
    validate_ref(
        CANONICAL_CONTAINER_FIXTURE_DIRECTORY
        / "canonical-container-intent.json",
        "storyboard.schema.json",
        "/$defs/canonicalContainerIntent",
    )
    validate_ref(
        CANONICAL_CONTAINER_FIXTURE_DIRECTORY
        / "canonical-container-plan.json",
        "storyboard.schema.json",
        "/$defs/canonicalContainerPlan",
    )
    validate_ref_instance(
        treatment_with_motion(
            {
                "kind": "state-sequence",
                "poseFamilyId": "traveler-loop",
                "stateId": "phase-a",
                "facing": "neutral",
                "visualChange": "The registered locomotion phase advances.",
                "playback": "loop",
                "transition": "cut",
                "cycles": 40,
            }
        ),
        "storyboard.schema.json",
        "/$defs/treatment",
        "state-sequence-long-cycle-proof",
    )
    validate_ref_instance(
        {
            "riskClass": "identity-critical",
            "contractIds": ["recurring-cast"],
            "generationFamily": {
                "familyId": "cast-family",
                "identityMemberIds": ["elder-scholar", "young-engineer"],
                "stateMemberIds": ["waiting", "welcoming"],
                "referenceAssetIds": ["cast-reference"],
            },
        },
        "asset-request.schema.json",
        "/properties/semanticBinding",
        "identity-generation-family-proof",
    )
    motif_overflow = treatment_with_motion(
        {
            "kind": "motif-field",
            "preset": "drift",
            "distribution": "scattered",
            "count": 8,
            "cycles": 13,
            "bounds": {"x": 0, "y": 0, "width": 1, "height": 1},
            "exclusionZones": [],
        }
    )
    motif_errors = list(
        Draft202012Validator(
            {
                "$ref": (
                    "https://local.paper-collage.dev/"
                    "storyboard.schema.json#/$defs/treatment"
                )
            },
            registry=registry,
        ).iter_errors(motif_overflow)
    )
    if not motif_errors:
        raise ValueError(
            "motif-field-cycle-cap-proof: cycles above 12 must be rejected"
        )
except (FileNotFoundError, KeyError, ValueError) as error:
    print(f"v12 schema validation failed:\n{error}", file=sys.stderr)
    raise SystemExit(1)

print(
    "✓ v12 authoring, compiled storyboard, three project contracts, "
    "asset manifests, looping-strip derivations, registered-family derivation, "
    "canonical-container intent/derivation/binding/compiled plan, primitive-specific cycle bounds, "
    "and rejected-output recovery "
    "are schema-valid"
)
