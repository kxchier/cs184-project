import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildMesh, defaultMaterial, defaultSolver, equilibrium, sampleMarkers } from '../viewer/flexible.js';

import { bookPages, classifyGeometry } from '../geometry/geometry-validity.js';

export { bookPages, classifyGeometry, finitePageContact, triangleContact } from '../geometry/geometry-validity.js';

const sub = (a, b) => a.map((x, i) => x - b[i]);
const length = v => Math.hypot(...v);

function run() {
  const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
  const config = read('../configs/baseline.json');
  const references = read('../results/angle-convergence.json').runs;
  const angle = 120;
  const mass = 0.16;
  const gravity = [0, 0, -9.81];
  const tolerances = { distance_m: config.geometry.ridge_length_m * 1e-7,
    relative_area: 1e-6, attachment_m: config.geometry.ridge_length_m * 1e-10,
    md2a_landmark_m: config.geometry.ridge_length_m * 1e-7 };
  const pages = bookPages(config, angle);
  const cases = [];
  for (const stiffness of [2e-6, 2e-5]) {
    for (const resolution of [4, 8, 12, 16]) {
      const material = { ...defaultMaterial, mass_per_area_kg_m2: mass, bending_stiffness_N_m: stiffness };
      const id = `angle-${angle}_n-${resolution}_mass-${mass}_D-${stiffness}`;
      const reference = references.find(record => record.id === id);
      const mesh = buildMesh(config, angle, resolution);
      const solved = equilibrium(mesh, material, defaultSolver, gravity);
      const record = { id, angle_deg: angle, mass_kg_m2: mass, stiffness_N_m: stiffness, resolution,
        residual_N_m2: solved.residual_N_m2, iterations: solved.iterations, solver_reason: solved.reason };
      if (!solved.converged || !Number.isFinite(solved.residual_N_m2) ||
          solved.residual_N_m2 > defaultSolver.residual_tolerance_N_m2 ||
          !solved.positions.every(Number.isFinite)) {
        cases.push({ ...record, status: 'unresolved', reason: 'solver_or_nonfinite_geometry' });
        continue;
      }
      const landmarks = sampleMarkers(mesh, solved.positions);
      const md2a_landmark_max_delta_m = Object.keys(landmarks).length === reference?.landmarks.length
        ? Math.max(...reference.landmarks.map(marker => landmarks[marker.name]
          ? length(sub(landmarks[marker.name], marker.deformed_m)) : Infinity))
        : Infinity;
      if (!(md2a_landmark_max_delta_m <= tolerances.md2a_landmark_m)) {
        cases.push({ ...record, status: 'unresolved', reason: 'md2a_landmark_mismatch',
          md2a_landmark_max_delta_m });
        continue;
      }
      cases.push({ ...record, md2a_landmark_max_delta_m, landmarks_m: landmarks,
        positions_m: solved.positions, triangles: mesh.triangles,
        ...classifyGeometry(mesh, solved.positions, pages, tolerances) });
    }
  }
  const output = { schema_version: 2, config, gravity_m_s2: gravity, solver_settings: defaultSolver,
    stretching_modulus_N_m: defaultMaterial.stretching_modulus_N_m, poisson_ratio: defaultMaterial.poisson_ratio,
    illustrative_uncalibrated: true, tolerances, pages_m: pages, cases };
  writeFileSync(new URL('../results/geometry-validity.json', import.meta.url), JSON.stringify(output) + '\n');
  if (cases.some(item => item.reason === 'md2a_landmark_mismatch')) {
    console.error('MD2A comparison failed. Do not interpret the sweep.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) run();
