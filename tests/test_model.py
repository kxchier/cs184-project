import copy
import json
import math
import unittest
from pathlib import Path

from vfold.model import solve


class RigidTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((Path(__file__).resolve().parents[1] / "configs/baseline.json").read_text())

    def test_panel_edge_lengths_and_attachment_planes(self):
        g = self.config["geometry"]
        a, h = g["attachment_length_m"], g["ridge_length_m"]
        edge = math.sqrt(a*a + h*h - 2*a*h*math.cos(math.radians(g["crease_angle_deg"])))
        for angle in [0, 0.001, 17.25, 60, 90, 179.999, 180]:
            p = solve(self.config, angle)["landmarks_m"]
            self.assertAlmostEqual(math.dist(p["spine_origin"], p["ridge_tip"]), h)
            for name in ["left_wing_tip", "right_wing_tip"]:
                self.assertAlmostEqual(math.dist(p["spine_origin"], p[name]), a)
                self.assertAlmostEqual(math.dist(p["ridge_tip"], p[name]), edge)
                half = math.radians(angle / 2)
                self.assertAlmostEqual(abs(p[name][0])*math.cos(half) - p[name][2]*math.sin(half), 0)

    def test_open_book_is_flat(self):
        for point in solve(self.config, 180)["landmarks_m"].values():
            self.assertAlmostEqual(point[2], 0)

    def test_invalid_inputs(self):
        for angle in [-1, 181, float("nan"), float("inf")]:
            with self.assertRaises(ValueError):
                solve(self.config, angle)
        config = copy.deepcopy(self.config)
        config["material"] = {"stiffness": 1}
        with self.assertRaises(ValueError):
            solve(config, 90)


if __name__ == "__main__":
    unittest.main()
