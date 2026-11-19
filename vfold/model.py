"""Rigid triangular wings with ideal hinges; see docs/model.md."""
import math


def validate(config):
    if config.get("schema_version") != 1:
        raise ValueError("schema_version must be 1")
    if config.get("model") != "rigid_ideal_hinges":
        raise ValueError("Only rigid_ideal_hinges is implemented")
    if config.get("units") != "SI":
        raise ValueError("units must be SI")
    g = config["geometry"]
    for key in ("attachment_length_m", "ridge_length_m"):
        if not math.isfinite(g[key]) or g[key] <= 0:
            raise ValueError(f"{key} must be finite and positive")
    beta = g["crease_angle_deg"]
    if not math.isfinite(beta) or not 0 < beta < 90:
        raise ValueError("crease_angle_deg must be between 0 and 90")
    if config.get("material") != {}:
        raise ValueError("Rigid baseline has no material parameters; material must be {}")
    if config.get("frame") != "spine_y_symmetric_pages_z_up":
        raise ValueError("Unsupported coordinate frame")


def solve(config, opening_angle_deg):
    validate(config)
    if not math.isfinite(opening_angle_deg) or not 0 <= opening_angle_deg <= 180:
        raise ValueError("Opening angle must be finite and within [0, 180]")
    g = config["geometry"]
    half = math.radians(opening_angle_deg / 2)
    beta = math.radians(g["crease_angle_deg"])
    a, h = g["attachment_length_m"], g["ridge_length_m"]
    x = a * math.sin(beta) * math.sin(half)
    y = a * math.cos(beta)
    z = a * math.sin(beta) * math.cos(half)
    k = math.tan(beta) * math.cos(half)
    ridge = [0.0, h * (1 - k*k) / (1 + k*k), 2*h*k / (1 + k*k)]
    return {
        "opening_angle_deg": opening_angle_deg,
        "landmarks_m": {
            "spine_origin": [0.0, 0.0, 0.0],
            "left_wing_tip": [-x, y, z],
            "right_wing_tip": [x, y, z],
            "ridge_tip": ridge,
        },
    }
