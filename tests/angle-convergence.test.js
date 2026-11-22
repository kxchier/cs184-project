import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { defaultSolver } from '../viewer/flexible.js';
import { compareLandmarks, matrix, runCase } from '../experiments/angle-convergence.mjs';

const read = name => JSON.parse(readFileSync(new URL('../' + name, import.meta.url)));
const config = read('configs/baseline.json');
const study = read('results/angle-convergence.json');

test('factorial case IDs are unique, stable, and match exported metadata', () => {
  const cases = matrix();
  assert.equal(cases.length, 64);
  assert.equal(new Set(cases.map(row => row.id)).size, 64);
  assert.deepEqual(matrix(), cases);
  assert.equal(study.pilot_ids.length, 8);
  assert.equal(study.comparisons.length, 48);
  assert.deepEqual(study.runs.map(run => run.id), cases.map(row => row.id));
  for (const [index, run] of study.runs.entries()) {
    const { angle, mass, stiffness, resolution } = cases[index];
    assert.equal(run.id, `angle-${angle}_n-${resolution}_mass-${mass}_D-${stiffness}`);
    assert.deepEqual([run.book_angle_deg, run.material.mass_per_area_kg_m2,
      run.material.bending_stiffness_N_m, run.mesh_resolution], [angle, mass, stiffness, resolution]);
    assert.deepEqual(run.configuration, config);
    assert.deepEqual(run.gravity_m_s2, [0, 0, -9.81]);
    assert.deepEqual(run.solver_settings, defaultSolver);
    assert.equal(run.pinned_max_shift_m, 0);
    assert.ok(Number.isFinite(run.energy_J));
  }
});

test('landmark differences match by name in millimetres and exclude the pinned points', () => {
  const coarse = structuredClone(study.runs[0]);
  const fine = structuredClone(coarse);
  const ridge = fine.landmarks.find(marker => marker.name === 'ridge_tip');
  ridge.deformed_m = ridge.deformed_m.map((coordinate, axis) => coordinate + [0.003, 0.004, 0][axis]);
  fine.landmarks.find(marker => marker.name === 'spine_origin').deformed_m = [1, 0, 0];
  fine.landmarks.reverse();
  const comparison = compareLandmarks(coarse, fine);
  assert.equal(comparison.status, 'compared');
  assert.ok(Math.abs(comparison.max_mm - 5) < 1e-12);
  assert.ok(Math.abs(comparison.rms_mm - 5 / Math.sqrt(5)) < 1e-12);
  assert.equal(comparison.pinned_mm.spine_origin, 1000);
  ridge.deformed_m[0] = NaN;
  assert.equal(compareLandmarks(coarse, fine).status, 'nonfinite');
  fine.landmarks.pop();
  assert.equal(compareLandmarks(coarse, fine).status, 'invalid_landmarks');
});

test('failed solves remain explicit and are excluded from refinement measurements', () => {
  const failed = runCase(config, matrix()[0], { ...defaultSolver, max_iterations: 1 });
  assert.equal(failed.status, 'solver_failed');
  assert.equal(failed.convergence.reason, 'iteration_limit');
  assert.equal(compareLandmarks(failed, study.runs[1]).status, 'unresolved_solver');
  const nonfinite = runCase(config, { ...matrix()[0], mass: Number.MAX_VALUE });
  assert.equal(nonfinite.status, 'nonfinite');
});

test('zero gravity returns the rigid reference and repeats deterministically except for timing', () => {
  const parameters = matrix().find(row => row.angle === 150 && row.resolution === 16);
  const run = () => {
    const { computation_time_ms, ...result } = runCase(config, parameters, defaultSolver, [0, 0, 0]);
    return result;
  };
  const first = run();
  assert.equal(first.status, 'converged');
  assert.equal(first.pinned_max_shift_m, 0);
  assert.equal(first.diagnostics.max_displacement_m, 0);
  assert.deepEqual(run(), first);
});

for (const source of ['milestone', 'material-sensitivity']) {
  test(`the sweep reproduces all overlapping ${source} cases`, () => {
    const references = read(`results/${source}.json`);
    for (const reference of references) {
      const match = study.runs.find(run => run.book_angle_deg === reference.book_angle_deg &&
        run.mesh_resolution === reference.mesh_resolution &&
        run.material.mass_per_area_kg_m2 === reference.material.mass_per_area_kg_m2 &&
        run.material.bending_stiffness_N_m === reference.material.bending_stiffness_N_m);
      assert.ok(match);
      assert.deepEqual(match.diagnostics, reference.diagnostics);
      assert.deepEqual(match.landmarks, reference.landmarks);
      assert.deepEqual(match.convergence, reference.convergence);
    }
  });
}
