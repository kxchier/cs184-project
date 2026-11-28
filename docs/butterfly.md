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

This is a zero-thickness, static equilibrium pilot with illustrative material values and ideal hinges. It adds no contact response or crease resistance. The audited MD1–MD4 results still describe the triangular baseline. This prototype supplies no evidence of physical calibration, thick-shell accuracy, dynamic unfolding, or a new numerical method.

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

## Interactive butterfly viewer

From the repository root, with the pinned local Three.js 0.170.0 package already present, start the loopback server:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open [the butterfly demo](http://127.0.0.1:8000/butterfly.html) in a WebGL browser. Stop the server with Control-C in its terminal. The import map uses the local package. This entry point and its modules make no external requests.

Choose 60° or 90°, coarse or refined topology, gravity off or on, and rigid reference or flexible static equilibrium. Drag to orbit, scroll to zoom, and use **Reset camera** to restore the initial view. The outlined pages are the finite quads used by the diagnostic. Wing surfaces follow indexed mechanical triangles. Lines follow the two actual boundary loops, the fixed page attachments, and the welded ridge.

Each change synchronously builds the mesh, optionally solves at the selected gravity, samples the named material points, checks the displayed positions, and replaces the scene and readouts. The controls can briefly block during a solve. A failed solve displays the rigid reference and labels any numerical metadata as belonging to the failed attempt. The rigid mode skips equilibrium solving and reports no solver residual or energy.

The shared browser-safe MD3 diagnostic checks the displayed geometry at 0.1×, 1× (nominal), and 10× the pilot distance tolerance. Its exemptions cover pinned page attachments and shared mesh features. Clearance requires a complete report with all three sweeps, both record arrays in each sweep, and valid diagnostic metadata. An exception or malformed report is shown as unavailable. The minimum relative area must agree with the reported degenerate triangle IDs at the checker’s inclusive area threshold. The reported status and tolerance sensitivity must also agree with the attachment drift and sweep evidence. Well-formed witnesses already reported by an incomplete check remain visible with their available provenance.

Each contact detail identifies the pair, geometry category, contact kind, tolerance multiplier, and confidence. A contact of the same kind on the same pair in all three sweeps is reported as confirmed. A sweep-dependent contact or boundary candidate is reported as uncertain and does not establish penetration. A separate confirmed violation remains visible when uncertainty is also present. Red marks confirmed witnesses. Amber marks candidate, tolerance-dependent, or incomplete evidence. Numerical convergence and geometric checking have separate readouts.

The viewer compares static equilibria with illustrative material parameters. It supplies no physical calibration, collision response, crease resistance, continuous unfolding, or evidence of spatial convergence. The gravity-on coarse/refined landmark discrepancies of 5.338 mm at 60° and 7.940 mm at 90° persisted at tighter force-residual tolerances. Use the eight-case reproduction command above to verify the numerical configurations independently of WebGL.

### Browser smoke test

The Codex in-app browser on macOS rendered the local WebGL scene. The two page outlines, two wing silhouettes, and shared ridge were visible during orbit. Scroll zoom and Reset camera changed and restored the view. The browser console reported no errors or warnings during the tested interactions.

| Opening | Mesh | Gravity | Iterations | Residual (N/m²) | Final energy (J) | Maximum lobe shift (mm) |
|---:|---|---|---:|---:|---:|---:|
| 60° | Coarse | Off | 0 | 3.62730e−12 | 1.32757e−32 | 0.000 |
| 60° | Coarse | On | 235 | 3.10293e−3 | 3.15024e−4 | 11.024 |
| 60° | Refined | On | 1,034 | 4.79480e−3 | 3.15962e−4 | 5.705 |
| 90° | Coarse | On | 429 | 4.09653e−3 | 2.65492e−4 | 17.158 |
| 90° | Refined | On | 723 | 4.14244e−3 | 2.67892e−4 | 9.287 |

All five displayed converged static equilibrium and no violation detected by the tested checks. At 90° refined with gravity on, switching to rigid reference cleared the solver readouts and gave zero lobe shift. Switching back restored the corresponding flexible readouts. Failure, unavailable diagnostics, and contact uncertainty were exercised with unit-test fixtures.

The R1 loopback rerun reproduced the five rows above and the remaining three gravity-off configurations. Both wings and the pages were visible, and the widened display selector showed the full mode label. Rigid mode cleared the solver metrics and returning to flexible mode restored the current values. The captured console had no warnings or errors. A separate in-memory viewer harness verified the contact-details row for a real 10×-only opposing-wing fixture, preservation of that row with an incomplete report, and removal of stale details when the checker threw.
