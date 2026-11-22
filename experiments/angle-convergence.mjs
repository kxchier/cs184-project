import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildMesh, defaultMaterial, defaultSolver, equilibrium, makeReport } from '../viewer/flexible.js';

const angles = [60, 90, 120, 150];
const resolutions = [4, 8, 12, 16];
const masses = [0.08, 0.16];
const stiffnesses = [2e-6, 2e-5];
const gravity = [0, 0, -9.81];
const pinnedNames = new Set(['spine_origin', 'left_wing_tip', 'right_wing_tip']);
const freeNames = ['ridge_tip', 'left_interior', 'right_interior', 'left_free_midpoint', 'right_free_midpoint'];

export function matrix() {
  return angles.flatMap(angle => masses.flatMap(mass => stiffnesses.flatMap(stiffness =>
    resolutions.map(resolution => ({
      angle, mass, stiffness, resolution,
      id: `angle-${angle}_n-${resolution}_mass-${mass}_D-${stiffness}`,
    })),
  )));
}

export function runCase(config, parameters, settings = defaultSolver, acceleration = gravity) {
  const { id, angle, mass, stiffness, resolution } = parameters;
  const material = {
    ...defaultMaterial, mass_per_area_kg_m2: mass, bending_stiffness_N_m: stiffness,
  };
  const mesh = buildMesh(config, angle, resolution);
  const start = performance.now();
  const solution = equilibrium(mesh, material, settings, acceleration);
  const { mesh: geometry, ...report } = makeReport(
    config, angle, mesh, material, settings, solution, performance.now() - start, acceleration,
  );
  const finite = [
    solution.energy_J, solution.residual_N_m2, solution.iterations, report.computation_time_ms,
    ...solution.positions, ...mesh.reference, ...Object.values(report.diagnostics),
    ...report.landmarks.flatMap(marker => [marker.displacement_m, ...marker.reference_m, ...marker.deformed_m]),
  ].every(Number.isFinite);
  const pinned_max_shift_m = Math.max(...geometry.pinned_vertex_ids.map(id =>
    Math.hypot(...[0, 1, 2].map(axis =>
      geometry.deformed_positions_m[3 * id + axis] - geometry.reference_positions_m[3 * id + axis])),
  ));
  return {
    id, ...report, energy_J: solution.energy_J, pinned_max_shift_m,
    status: finite ? (solution.converged ? 'converged' : 'solver_failed') : 'nonfinite',
  };
}

export function compareLandmarks(coarse, fine) {
  const pair = { coarse_id: coarse.id, fine_id: fine.id };
  if (coarse.status !== 'converged' || fine.status !== 'converged') {
    return { ...pair, status: 'unresolved_solver' };
  }
  const expected = [...pinnedNames, ...freeNames];
  const maps = [coarse, fine].map(run => new Map(run.landmarks.map(marker => [marker.name, marker.deformed_m])));
  if ([coarse, fine].some(run => run.landmarks.length !== expected.length) ||
      maps.some(map => expected.some(name => !map.has(name)))) {
    return { ...pair, status: 'invalid_landmarks' };
  }
  if (maps.some(map => expected.some(name => {
    const point = map.get(name);
    return !Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite);
  }))) return { ...pair, status: 'nonfinite' };

  const difference = name => {
    const [a, b] = maps.map(map => map.get(name));
    return 1000 * Math.hypot(...a.map((value, axis) => value - b[axis]));
  };
  const differences = names => Object.fromEntries(names.map(name => [name, difference(name)]));
  const free_mm = differences(freeNames);
  const values = Object.values(free_mm);
  const pinned_mm = differences([...pinnedNames]);
  if (![...values, ...Object.values(pinned_mm)].every(Number.isFinite)) {
    return { ...pair, status: 'nonfinite' };
  }
  return {
    ...pair, status: 'compared', free_mm, pinned_mm,
    rms_mm: Math.hypot(...values) / Math.sqrt(values.length),
    max_mm: Math.max(...values),
  };
}

function study(config, pilotOnly) {
  const cases = matrix();
  const pilotCases = cases.filter(({ angle, mass, stiffness, resolution }) =>
    [90, 150].includes(angle) && resolution >= 12 &&
    ((mass === 0.08 && stiffness === 2e-5) || (mass === 0.16 && stiffness === 2e-6)),
  );
  const pilot = new Map(pilotCases.map(parameters => [parameters.id, runCase(config, parameters)]));
  const pilotPassed = [...pilot.values()].every(run =>
    run.status === 'converged' && run.pinned_max_shift_m === 0 && run.computation_time_ms <= 30000,
  );
  const completed = pilotPassed && !pilotOnly;
  const runs = completed ? cases.map(parameters => pilot.get(parameters.id) ?? runCase(config, parameters))
    : [...pilot.values()];
  const comparisons = runs.flatMap((coarse, index) => {
    const fine = runs[index + 1];
    return fine && coarse.book_angle_deg === fine.book_angle_deg &&
      coarse.material.mass_per_area_kg_m2 === fine.material.mass_per_area_kg_m2 &&
      coarse.material.bending_stiffness_N_m === fine.material.bending_stiffness_N_m
      ? [compareLandmarks(coarse, fine)] : [];
  });
  return {
    schema_version: 1, completed, pilot_passed: pilotPassed, pilot_ids: [...pilot.keys()],
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    runs, comparisons,
  };
}

function writeResults(result) {
  const basename = new URL(result.completed ? '../results/angle-convergence' :
    '../results/angle-convergence-pilot', import.meta.url);
  const columns = ['case_id', 'angle_deg', 'resolution', 'mass_kg_m2', 'stiffness_N_m', 'status',
    'reason', 'residual_N_m2', 'iterations', 'solver_ms', 'energy_J', 'rms_mm', 'max_mm'];
  const rows = result.runs.map(run => [
    run.id, run.book_angle_deg, run.mesh_resolution, run.material.mass_per_area_kg_m2,
    run.material.bending_stiffness_N_m, run.status, run.convergence.reason,
    run.convergence.residual_N_m2, run.convergence.iterations, run.computation_time_ms,
    run.energy_J, 1000 * run.diagnostics.rms_displacement_m, 1000 * run.diagnostics.max_displacement_m,
  ]);
  writeFileSync(fileURLToPath(basename) + '.json', JSON.stringify(result, null, 2) + '\n');
  writeFileSync(fileURLToPath(basename) + '.csv', [columns, ...rows]
    .map(row => row.map(value => typeof value === 'number' && !Number.isFinite(value) ? '' : value).join(','))
    .join('\n') + '\n');
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  const config = JSON.parse(readFileSync(new URL('../configs/baseline.json', import.meta.url)));
  const result = study(config, process.argv.includes('--pilot'));
  writeResults(result);
  console.log(`Pilot: ${result.pilot_passed ? 'passed' : 'stopped'}; recorded ${result.runs.length} cases.`);
  if (!result.pilot_passed) process.exitCode = 1;
}
