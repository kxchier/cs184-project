import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildMesh, defaultMaterial, defaultSolver, equilibrium, makeReport, reportCSV } from '../viewer/flexible.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const config = JSON.parse(read('../configs/baseline.json'));
const reports = JSON.parse(read('../results/material-sensitivity.json'));

test('the eight cases retain complete metadata, finite measurements, and exact attachments', () => {
  const expected = [0.08, 0.16].flatMap(mass =>
    [2e-6, 2e-5].flatMap(stiffness => [4, 8].map(n => [mass, stiffness, n])),
  );
  assert.deepEqual(reports.map(report => [
    report.material.mass_per_area_kg_m2, report.material.bending_stiffness_N_m, report.mesh_resolution,
  ]), expected);

  for (const report of reports) {
    assert.deepEqual(report.configuration, config);
    assert.equal(report.book_angle_deg, 90);
    assert.equal(report.units, 'SI');
    assert.equal(report.schema_version, 1);
    assert.equal(report.model, 'quadratic_bending_stvk_ideal_hinges');
    assert.deepEqual(report.gravity_m_s2, [0, 0, -9.81]);
    assert.deepEqual(report.solver_settings, defaultSolver);
    assert.deepEqual(report.material, {
      ...defaultMaterial,
      mass_per_area_kg_m2: report.material.mass_per_area_kg_m2,
      bending_stiffness_N_m: report.material.bending_stiffness_N_m,
    });
    const { convergence, diagnostics, landmarks, mesh } = report;
    assert.equal(landmarks.length, 8);
    assert.equal(mesh.pinned_vertex_ids.length, 2 * report.mesh_resolution + 1);
    for (const id of mesh.pinned_vertex_ids) {
      assert.deepEqual(mesh.deformed_positions_m.slice(3 * id, 3 * id + 3),
        mesh.reference_positions_m.slice(3 * id, 3 * id + 3));
    }
    const measurements = [
      diagnostics.rms_displacement_m, diagnostics.max_displacement_m,
      diagnostics.max_abs_edge_strain, diagnostics.rms_edge_strain,
      convergence.residual_N_m2, convergence.iterations, report.computation_time_ms,
      ...landmarks.flatMap(marker => [marker.displacement_m, ...marker.reference_m, ...marker.deformed_m]),
      ...mesh.reference_positions_m, ...mesh.deformed_positions_m,
    ];
    assert.ok(measurements.every(Number.isFinite));
    assert.equal(typeof convergence.converged, 'boolean');
    assert.ok(convergence.reason.length > 0);
    if (convergence.converged) {
      assert.ok(convergence.residual_N_m2 <= defaultSolver.residual_tolerance_N_m2);
    }
  }
  assert.equal(read('../results/material-sensitivity.csv'), reportCSV(reports));
});

test('both mass settings preserve the rigid reference in zero gravity', () => {
  const mesh = buildMesh(config, 90, 4);
  for (const mass of [0.08, 0.16]) {
    const result = equilibrium(mesh, { ...defaultMaterial, mass_per_area_kg_m2: mass },
      defaultSolver, [0, 0, 0]);
    assert.equal(result.converged, true);
    assert.deepEqual(result.positions, mesh.reference);
  }
});

test('an iteration-limited case retains its failure status in both output formats', () => {
  const mesh = buildMesh(config, 90, 4);
  const settings = { ...defaultSolver, max_iterations: 1 };
  const result = equilibrium(mesh, defaultMaterial, settings);
  const report = makeReport(config, 90, mesh, defaultMaterial, settings, result, 0);
  assert.equal(JSON.parse(JSON.stringify(report)).convergence.converged, false);
  assert.equal(report.convergence.reason, 'iteration_limit');
  const [header, row] = reportCSV([report]).trimEnd().split('\n');
  const statusColumn = header.split(',').indexOf('"converged"');
  assert.equal(row.split(',')[statusColumn], '"false"');
  assert.match(row, /"iteration_limit"/);
});
