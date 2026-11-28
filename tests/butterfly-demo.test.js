import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { butterflyState, tolerances } from '../viewer/butterfly-state.js';
import { buildButterflyMesh } from '../viewer/butterfly-mesh.js';
import { defaultMaterial, defaultSolver, equilibrium, sampleMarkers } from '../viewer/flexible.js';
import { bookPages, classifyGeometry } from '../geometry/geometry-validity.js';

const config = JSON.parse(readFileSync(new URL('../configs/baseline.json', import.meta.url)));
const initial = { angle: 60, level: 0, gravity: false, flexible: true };

test('each viewer combination maps the exact topology, pages, landmarks and solver values', () => {
  for (const angle of [60, 90]) for (const level of [0, 1]) for (const gravity of [false, true]) {
    const selection = { angle, level, gravity, flexible: true };
    const state = butterflyState(config, selection, {
      solve(mesh, material, settings, acceleration) {
        assert.deepEqual(mesh, buildButterflyMesh(config, angle, level));
        assert.deepEqual(material, defaultMaterial);
        assert.equal(settings, defaultSolver);
        assert.deepEqual(acceleration, [0, 0, gravity ? -9.81 : 0]);
        return equilibrium(mesh, material, settings, acceleration);
      },
    });
    assert.deepEqual(state.selection, selection);
    assert.deepEqual(state.pages, bookPages(config, angle));
    assert.deepEqual([state.vertexCount, state.triangleCount], level ? [39, 48] : [14, 12]);
    const { positions, converged, ...metadata } =
      equilibrium(state.mesh, defaultMaterial, defaultSolver, state.gravity_m_s2);
    assert.equal(converged, true);
    assert.deepEqual(state.solver, { status: 'converged', ...metadata });
    assert.ok(state.solver.residual_N_m2 <= defaultSolver.residual_tolerance_N_m2);
    assert.deepEqual(state.positions, positions);
    assert.deepEqual(state.landmarks_m, sampleMarkers(state.mesh, positions));
    assert.deepEqual(state.referenceLandmarks_m, sampleMarkers(state.mesh, state.mesh.reference));
    assert.equal(state.contactStatus, 'No violation detected by the tested checks');
    assert.equal(state.contactRecords.length, 0);
    if (gravity) assert.notDeepEqual(positions, state.mesh.reference);
    else assert.deepEqual(positions, state.mesh.reference);
  }
});

test('rigid state after a solve uses the current reference and no solver metadata', () => {
  const previous = butterflyState(config, { ...initial, gravity: true });
  const state = butterflyState(config, { ...initial, angle: 90, level: 1, flexible: false }, {
    solve() { assert.fail('Rigid mode must skip the solver'); },
    diagnose(mesh, positions, pages, settings) {
      assert.equal(positions, mesh.reference);
      assert.deepEqual(pages, bookPages(config, 90));
      assert.equal(settings, tolerances);
      return classifyGeometry(mesh, positions, pages, settings);
    },
  });
  assert.deepEqual(state.solver, { status: 'reference' });
  assert.equal(state.positions, state.mesh.reference);
  assert.notDeepEqual(state.landmarks_m, previous.landmarks_m);
  assert.deepEqual(state.landmarks_m, state.referenceLandmarks_m);
});

test('failed, malformed and throwing solves retain reference and never claim success', () => {
  for (const solve of [
    () => ({ converged: false, reason: 'iteration_limit', iterations: 7, residual_N_m2: 1, energy_J: 2, positions: [0] }),
    () => ({ converged: true, positions: [NaN] }),
    () => { throw new Error('fixture failure'); },
  ]) {
    const state = butterflyState(config, { ...initial, gravity: true }, { solve });
    assert.equal(state.solver.status, 'failed');
    assert.equal(state.positions, state.mesh.reference);
    assert.deepEqual(state.landmarks_m, state.referenceLandmarks_m);
    assert.equal(state.geometry.status, 'valid');
  }
});

test('unavailable or unresolved diagnostics cannot produce a clear label', () => {
  for (const diagnose of [
    () => { throw new Error('diagnostic fixture'); },
    () => ({ status: 'unresolved', reason: 'nonfinite fixture' }),
  ]) {
    const state = butterflyState(config, initial, { diagnose });
    assert.equal(state.solver.status, 'converged');
    assert.equal(state.contactStatus, 'Geometric check unavailable');
    assert.ok(state.geometry.reason);
  }
});

test('confirmed crossing and candidate-only records stay distinct', () => {
  const pageHit = { category: 'panel_page', kind: 'noncoplanar-contact', ids: [0, 0, 0], points_m: [[0, 0, 0]] };
  const candidate = { ...pageHit, kind: 'boundary-candidate' };
  const other = { ...pageHit, kind: 'coplanar-contact' };
  const selection = { ...initial, gravity: true };
  const state = butterflyState(config, selection, {
    solve(mesh) {
      const positions = [...mesh.reference];
      const [a, b] = mesh.triangles[0].ids;
      positions[3 * a] = -1; positions[3 * a + 2] = 0;
      positions[3 * b] = 1; positions[3 * b + 2] = 0;
      return { positions, converged: true, reason: 'force_residual', iterations: 4, residual_N_m2: 0.001, energy_J: 0.2 };
    },
    diagnose: () => ({
      ...clearReport,
      status: 'invalid',
      tolerance_sensitive: true,
      sweeps: clearReport.sweeps.map(({ multiplier }) => ({
        multiplier, contacts: [pageHit, other], boundary_candidates: multiplier >= 1 ? [candidate] : [],
      })),
    }),
  });
  assert.equal(state.contactStatus, 'Detected geometric violation');
  const crossings = state.contactRecords.filter(hit => hit.label.startsWith('Transverse page crossing'));
  assert.deepEqual(crossings.map(hit => hit.multiplier), [0.1, 1, 10]);
  assert.ok(crossings.every(hit => hit.confidence === 'confirmed'));
  assert.match(crossings[1].label, /panel_page \[0, 0, 0\] · 1× nominal tolerance · confirmed/);
  assert.equal(state.contactRecords.filter(hit => hit.label.startsWith('Coplanar contact')).length, 3);
  const candidates = state.contactRecords.filter(hit => hit.confidence === 'boundary candidate');
  assert.deepEqual(candidates.map(hit => hit.multiplier), [1, 10]);
  assert.ok(candidates.every(hit => hit.kind === 'boundary-candidate'));
  assert.equal(state.uncertain, true);
  const ambiguous = withGeometry({
    ...clearReport, status: 'ambiguous', tolerance_sensitive: true,
    sweeps: clearReport.sweeps.map(sweep => ({
      ...sweep, boundary_candidates: sweep.multiplier === 1 ? [candidate] : [],
    })),
  });
  assert.equal(ambiguous.contactStatus, 'Unresolved contact candidate');
  assert.equal(ambiguous.contactRecords.length, 1);
  assert.match(ambiguous.contactRecords[0].label, /1× nominal tolerance · boundary candidate/);
});

const clearReport = butterflyState(config, { ...initial, flexible: false }).geometry;
const withGeometry = geometry => butterflyState(config, { ...initial, flexible: false }, { diagnose: () => geometry });

test('clearance requires the complete checker contract', () => {
  assert.equal(withGeometry(clearReport).contactStatus, 'No violation detected by the tested checks');
  const [strict, nominal, wide] = clearReport.sweeps;
  for (const result of [
    { status: 'valid' },
    { ...clearReport, minimum_relative_area: undefined },
    { ...clearReport, sweeps: [strict, wide] },
    { ...clearReport, sweeps: [null, nominal, wide] },
    { ...clearReport, sweeps: [strict, { ...nominal, contacts: undefined }, wide] },
    { ...clearReport, sweeps: [strict, { ...nominal, boundary_candidates: null }, wide] },
    { ...clearReport, sweeps: [strict, { ...nominal, contacts: [null] }, wide] },
    { ...clearReport, sweeps: [strict, nominal, nominal] },
  ]) {
    assert.equal(withGeometry(result).contactStatus, 'Geometric check unavailable');
  }
});

test('real checker sweep-only contacts retain category, pair, witness and UI label', () => {
  const positions = [1, 0, 0, 1.1, 0, 0, 1, 0.1, 0, 1, 0, 5e-8, 1.1, 0, 5e-8, 1, 0.1, 5e-8];
  for (const panel of [0, 1]) {
    const mesh = { reference: positions, pins: [],
      triangles: [{ ids: [0, 1, 2], panel: 0 }, { ids: [3, 4, 5], panel }] };
    const report = classifyGeometry(mesh, positions, bookPages(config, 60), tolerances);
    assert.deepEqual(report.sweeps.map(sweep => sweep.contacts.length), [0, 0, 1]);
    const state = withGeometry(report);
    assert.equal(state.contactStatus, 'Unresolved contact candidate');
    const [record] = state.contactRecords;
    const category = panel ? 'between_panels' : 'within_panel';
    assert.deepEqual(record.ids, [0, 1]);
    assert.deepEqual(record.points_m, report.sweeps[2].contacts[0].points_m);
    assert.equal(record.multiplier, 10);
    assert.equal(record.confidence, 'tolerance-dependent');
    assert.ok(record.label.includes(category + ' [0, 1] · 10× tolerance · tolerance-dependent'));
  }
});

test('malformed tolerance metadata preserves positive evidence without claiming confirmation', () => {
  const hit = { category: 'between_panels', ids: [0, 7], kind: 'coplanar-contact', points_m: [[0, 0, 0]] };
  for (const multiplier of [undefined, '10', 2]) {
    const state = withGeometry({ ...clearReport, sweeps: clearReport.sweeps.map(sweep =>
      sweep.multiplier === 10 ? { ...sweep, multiplier, contacts: [hit] } : sweep) });
    assert.equal(state.contactStatus, 'Geometric check unavailable');
    assert.equal(state.contactRecords.length, 1);
    assert.deepEqual(state.contactRecords[0].points_m, hit.points_m);
    assert.match(state.contactRecords[0].label, /between_panels \[0, 7\] · tolerance unknown · incomplete check/);
  }
});

test('a separate stable violation stays confirmed when another pair varies across sweeps', () => {
  const stable = { category: 'between_panels', ids: [0, 7], kind: 'coplanar-contact', points_m: [[0, 0, 0]] };
  const varying = { ...stable, ids: [1, 8] };
  const state = withGeometry({
    ...clearReport, status: 'ambiguous', tolerance_sensitive: true,
    sweeps: clearReport.sweeps.map(sweep => ({
      ...sweep, contacts: sweep.multiplier === 10 ? [stable, varying] : [stable],
    })),
  });
  assert.equal(state.contactStatus, 'Detected geometric violation');
  assert.equal(state.uncertain, true);
  assert.deepEqual(state.contactRecords.map(hit => hit.confidence),
    ['confirmed', 'confirmed', 'confirmed', 'tolerance-dependent']);
});

test('area metadata agrees with the checker at the inclusive degeneracy threshold', () => {
  for (const minimum_relative_area of [0, tolerances.relative_area, NaN, Infinity]) {
    assert.equal(withGeometry({ ...clearReport, minimum_relative_area }).contactStatus,
      'Geometric check unavailable');
  }
  const reference = [1, 0, 0, 2, 0, 0, 1, 1, 0];
  const mesh = { reference, pins: [], triangles: [{ ids: [0, 1, 2], panel: 0 }] };
  const pages = bookPages(config, 60);
  for (const factor of [1, 2]) {
    const positions = [...reference];
    positions[7] = factor * tolerances.relative_area;
    const result = classifyGeometry(mesh, positions, pages, tolerances);
    assert.equal(result.minimum_relative_area, positions[7]);
    assert.deepEqual(result.degenerate_triangles, factor === 1 ? [0] : []);
    assert.equal(withGeometry(result).contactStatus, factor === 1 ? 'Detected geometric violation'
      : 'No violation detected by the tested checks');
  }
});

test('contradictory invalid status cannot promote an authentic 10×-only contact', () => {
  const positions = [1, 0, 0, 1.1, 0, 0, 1, 0.1, 0, 1, 0, 5e-8, 1.1, 0, 5e-8, 1, 0.1, 5e-8];
  const mesh = { reference: positions, pins: [],
    triangles: [{ ids: [0, 1, 2], panel: 0 }, { ids: [3, 4, 5], panel: 1 }] };
  const report = classifyGeometry(mesh, positions, bookPages(config, 60), tolerances);
  const consistent = withGeometry(report);
  assert.equal(consistent.contactStatus, 'Unresolved contact candidate');
  const contradictory = withGeometry({ ...report, status: 'invalid' });
  assert.equal(contradictory.contactStatus, 'Geometric check unavailable');
  assert.equal(contradictory.confirmed, false);
  assert.deepEqual(contradictory.contactRecords, consistent.contactRecords);
  assert.match(contradictory.contactRecords[0].label, /between_panels \[0, 1\] · 10× tolerance · tolerance-dependent/);
  assert.equal(withGeometry({ ...report, tolerance_sensitive: false }).contactStatus, 'Geometric check unavailable');
});

test('a real repeatable contact survives unrelated contradictory metadata', () => {
  const positions = [1, 0, 0, 2, 0, 0, 1, 1, 0, 1.2, 0.2, 0, 1.4, 0.2, 0, 1.2, 0.4, 0];
  const mesh = { reference: positions, pins: [],
    triangles: [{ ids: [0, 1, 2], panel: 0 }, { ids: [3, 4, 5], panel: 1 }] };
  const report = classifyGeometry(mesh, positions, bookPages(config, 60), tolerances);
  const confirmed = withGeometry(report);
  assert.equal(confirmed.contactStatus, 'Detected geometric violation');
  assert.deepEqual(confirmed.contactRecords.map(hit => hit.multiplier), [0.1, 1, 10]);
  const contradictory = withGeometry({ ...report, minimum_relative_area: 0 });
  assert.equal(contradictory.contactStatus, 'Geometric check unavailable');
  assert.deepEqual(contradictory.contactRecords, confirmed.contactRecords);

  const next = butterflyState(config, { ...initial, angle: 90 }, {
    diagnose() { throw new Error('fixture diagnostic exception'); },
  });
  assert.equal(next.contactStatus, 'Geometric check unavailable');
  assert.deepEqual(next.contactRecords, []);
  assert.equal(next.geometry.reason, 'fixture diagnostic exception');
});
