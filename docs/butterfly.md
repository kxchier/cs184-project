# Butterfly mesh feasibility

The solver minimizes energy over the butterfly triangles themselves. Each wing is a fixed, lobed planar domain with distinct forewing and hindwing landmarks. The straight attachment and ridge chains remain part of the boundary. The baseline triangular mesh and the MD1–MD4 experiments use their original code and data.

## Rest geometry and assembly

The eight outline vertices and six seed faces per wing are explicit in [butterfly-mesh.js](../viewer/butterfly-mesh.js). Coordinates `(u,v)` are coefficients of the rigid attachment and ridge vectors. At an opening angle, a wing point is `O + u(P−O) + v(C−O)`, where `O` is the spine origin, `P` is the attachment tip, and `C` is the ridge tip. The rigid V-fold preserves both vector lengths and their included angle of 30° for the baseline. Consequently, this placement preserves the metric of each material wing across angles.

The `v = 0` chain pins to the page, and the `u = 0` chain shares global vertex IDs across the wings. The right panel reverses face winding. The two face-oriented boundary loops are exported separately, including the common fold edge on each loop. Only physical attachment vertices are pinned. Bending stencils span interior edges within a wing. The welded ridge uses the existing ideal hinge, with no ridge bending penalty.

Level 1 replaces each level-0 triangle with four midpoint triangles. Midpoints are deduplicated on shared edges, and corresponding ridge midpoints are welded during placement. The area and outline stay fixed. The minimum rest triangle angle is 20.07° and the maximum aspect ratio is 3.741 at both levels. Aspect ratio here is the longest edge divided by its corresponding altitude. The builder rejects triangles below 10° or above an aspect ratio of 8 as a mesh quality gate.

The isolated builder assembles the same inverse rest edge matrices, per-triangle membrane areas, cotangent bending stencils, and one-third area lumping used by the triangular solver. It uses the existing energy, gradients, and optimizer. The total reference area is 0.0077512 m², and the mass at 0.08 kg/m² is 0.000620096 kg. Tests check the common support triangle against the baseline element, the affine null condition for bending stencils, component-wise finite differences, and material scaling.

## Eight-case numerical pilot

The two mesh levels use 14 vertices and 12 triangles (level 0), and 39 vertices and 48 triangles (level 1). The pinned IDs are `[0,1,8]` and `[0,19,1,38,21]` respectively. All pins stayed fixed exactly. The rigid reference is the angle-specific rest embedding. The zero-gravity solve reproduced it at every angle and level.

Each run used the baseline support configuration, areal mass 0.08 kg/m², bending stiffness 2e−5 N·m, stretching modulus 100 N/m, Poisson ratio 0.3, and the existing solver settings. The only controlled load change was gravity, either zero or −9.81 m/s² in z. All eight cases reached the 0.005 N/m² force-residual criterion. The lobe shift is the maximum Euclidean displacement over the four free forewing and hindwing landmarks relative to that run's rigid reference.

| Angle | Level | Gravity z (m/s²) | Iterations | Energy (J) | Residual (N/m²) | Max lobe shift (mm) | Min. area / reference | Geometry |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 60° | 0 | 0 | 0 | 1.33e−32 | 3.63e−12 | 0 | 1.000000 | Clear |
| 60° | 0 | −9.81 | 235 | 3.15024e−4 | 0.003103 | 11.024 | 0.999750 | Clear |
| 60° | 1 | 0 | 0 | 4.79e−32 | 1.86e−11 | 0 | 1.000000 | Clear |
| 60° | 1 | −9.81 | 1,034 | 3.15962e−4 | 0.004795 | 5.705 | 0.999335 | Clear |
| 90° | 0 | 0 | 0 | 1.65e−32 | 3.07e−12 | 0 | 1.000000 | Clear |
| 90° | 0 | −9.81 | 429 | 2.65492e−4 | 0.004097 | 17.158 | 0.999684 | Clear |
| 90° | 1 | 0 | 0 | 3.14e−32 | 1.38e−11 | 0 | 1.000000 | Clear |
| 90° | 1 | −9.81 | 723 | 2.67892e−4 | 0.004142 | 9.287 | 0.999243 | Clear |

The command below records all four named lobe coordinates in metres for each run, along with reference coordinates, material values, mesh metadata, solver outcomes, and diagnostics. Gravity moved the free lobe landmarks at both angles and levels. The largest mismatch between the loaded coarse and refined lobe positions was 5.338 mm at 60° and 7.940 mm at 90°. These are material-point comparisons within the same outline. They show mesh sensitivity and do not establish continuum convergence.

## Geometric checks and limitations

The MD3 helper checks nominal finite pages and within-panel and opposing-panel contacts. Its intended-contact rules use the shared ridge IDs and pinned reference vertices. The pilot used the existing 1e−8 m baseline distance tolerance and its 0.1×, 1×, and 10× sweep, 1e−11 m attachment tolerance, and 1e−6 relative-area threshold. All eight cases had zero attachment drift, zero flagged crossings or degeneracy, and zero boundary candidates at all three tolerances. Clear means no violation detected by those checks. Artificial crossing and overlap fixtures verify that the diagnostic can flag violations on this topology. The endpoint angle checks cover rest lengths and areas and supply no collision-free claim for closure or flattening.

This is a zero-thickness, static equilibrium pilot with illustrative material values and ideal hinges. It adds no contact response or crease resistance. The audited MD1–MD4 results still describe the triangular baseline. This prototype supplies no evidence of physical calibration, thick-shell accuracy, dynamic unfolding, or a new numerical method. Browser rendering and a demonstration interface are outside this milestone.

## Reproduction

From the repository root, run the focused tests with `node --test tests/butterfly-mesh.test.js`. Run the full suite with `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -q` and `node --test tests/*.test.js`.

The pilot writes its eight records to standard output.

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { buildButterflyMesh } from './viewer/butterfly-mesh.js';
import { defaultMaterial, defaultSolver, equilibrium, sampleMarkers } from './viewer/flexible.js';
import { bookPages, classifyGeometry } from './experiments/geometry-validity.mjs';

const config = JSON.parse(readFileSync('configs/baseline.json'));
const tolerance = { distance_m: 1e-8, attachment_m: 1e-11, relative_area: 1e-6 };
for (const angle_deg of [60, 90]) for (const level of [0, 1]) {
  const mesh = buildButterflyMesh(config, angle_deg, level);
  for (const gravity_m_s2 of [[0, 0, 0], [0, 0, -9.81]]) {
    const { positions, ...solve } = equilibrium(mesh, defaultMaterial, defaultSolver, gravity_m_s2);
    const reference_landmarks_m = sampleMarkers(mesh, mesh.reference);
    const landmarks_m = sampleMarkers(mesh, positions);
    const max_lobe_shift_mm = 1000 * Math.max(...Object.entries(landmarks_m).map(([name, p]) =>
      Math.hypot(...p.map((value, i) => value - reference_landmarks_m[name][i]))));
    console.log(JSON.stringify({
      angle_deg, level, gravity_m_s2, material: defaultMaterial, settings: defaultSolver,
      vertices: mesh.areas.length, triangles: mesh.triangles.length, rest: mesh.quality,
      mass_kg: defaultMaterial.mass_per_area_kg_m2 * mesh.quality.area_m2,
      pins: mesh.pins, attachments: mesh.attachments, ridge: mesh.ridge,
      reference_landmarks_m, landmarks_m, max_lobe_shift_mm, solve,
      geometry: classifyGeometry(mesh, positions, bookPages(config, angle_deg), tolerance),
    }));
  }
}
JS
```
