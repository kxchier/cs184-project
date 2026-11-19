import argparse
import csv
import hashlib
import json
from pathlib import Path

from .model import solve, validate


def main():
    parser = argparse.ArgumentParser(description="Export rigid V-fold landmarks in metres")
    parser.add_argument("config", type=Path)
    parser.add_argument("--angles", type=float, nargs="+", help="Override configured opening angles in degrees")
    parser.add_argument("--output", type=Path, required=True, help="JSON output, including full configuration")
    parser.add_argument("--csv", type=Path, help="Optional long-form landmark CSV")
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    validate(config)
    angles = args.angles if args.angles is not None else config["opening_angles_deg"]
    if not angles:
        parser.error("At least one opening angle is required")
    samples = [solve(config, angle) for angle in angles]
    canonical = json.dumps(config, sort_keys=True, separators=(",", ":"), allow_nan=False)
    config_id = hashlib.sha256(canonical.encode()).hexdigest()
    result = {"export_schema_version": 1, "config_sha256": config_id,
              "configuration": config, "samples": samples}
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    if args.csv:
        with args.csv.open("w", newline="") as stream:
            writer = csv.writer(stream)
            writer.writerow(["config_sha256", "model", "opening_angle_deg", "landmark", "x_m", "y_m", "z_m",
                             "attachment_length_m", "ridge_length_m", "crease_angle_deg", "frame"])
            g = config["geometry"]
            for sample in samples:
                for name, position in sample["landmarks_m"].items():
                    writer.writerow([config_id, config["model"], sample["opening_angle_deg"], name, *position,
                                     g["attachment_length_m"], g["ridge_length_m"], g["crease_angle_deg"], config["frame"]])


if __name__ == "__main__":
    main()
