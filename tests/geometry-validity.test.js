import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bookPages, classifyGeometry, finitePageContact, triangleContact } from '../experiments/geometry-validity.mjs';

const eps = 1e-8;
const a = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
const contact = (b, allowed) => triangleContact(a, b, eps, allowed).kind;

test('triangle contact distinguishes transverse crossings from disjoint geometry', () => {
  assert.equal(contact([[0, 0, 1], [1, 0, 1], [0, 1, 1]]), 'disjoint');
  assert.equal(contact([[0.2, 0.2, -1], [0.2, 0.2, 1], [0.2, 0.7, 0]]), 'noncoplanar-contact');
});

test('coplanar clipping detects overlap, including edge-only crossings with no enclosed vertex', () => {
  assert.equal(contact([[0.8, 0.8, 0], [1, 0.8, 0], [0.8, 1, 0]]), 'disjoint');
  assert.equal(contact([[0.2, 0.2, 0], [0.4, 0.2, 0], [0.2, 0.4, 0]]), 'coplanar-contact');
  assert.equal(contact([[-1, 0.4, 0], [1, 0.4, 0], [-1, 0.5, 0]]), 'coplanar-contact');
});

test('only the explicit shared vertex or edge is allowed', () => {
  assert.equal(contact([[0, 0, 0], [-1, 0, 1], [0, -1, 1]], [a[0]]), 'allowed');
  assert.equal(contact([[0, 0, 0], [1, 0, 0], [0, 0, 1]], a.slice(0, 2)), 'allowed');
  assert.equal(contact([[0, 0, 0], [1, 0, 0], [0.2, 0.2, 0]], a.slice(0, 2)), 'coplanar-contact');
});

const fixture = (vertices, pins = []) => ({
  reference: vertices.flat(), pins, triangles: [{ ids: [0, 1, 2], panel: 0 }],
});
const settings = { distance_m: eps, attachment_m: 1e-10, relative_area: 1e-6 };
const page = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
const classify = (vertices, pages = [page]) => {
  const mesh = fixture(vertices);
  return classifyGeometry(mesh, mesh.reference, pages, settings);
};

test('finite page crossings are detected and off-page plane crossings are excluded', () => {
  const crossed = classify([[0.2, 0.2, -1], [0.2, 0.2, 1], [0.2, 0.7, 0]]);
  assert.equal(crossed.status, 'invalid');
  assert.ok(crossed.sweeps[1].contacts.every(hit => hit.category === 'panel_page'));
  assert.equal(classify([[1.2, 0.2, -1], [1.2, 0.2, 1], [1.2, 0.7, 0]]).status, 'valid');
  const pages = bookPages({ geometry: { attachment_length_m: 0.08, ridge_length_m: 0.1 } }, 120);
  assert.ok(Math.abs(pages[1][1][0] - 0.13 * Math.sin(Math.PI / 3)) < 1e-14);
});

test('near-coplanar tolerance sensitivity is ambiguous', () => {
  const result = classify(a.map(([x, y]) => [x, y, eps / 2]));
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.tolerance_sensitive, true);
  assert.equal(result.sweeps[0].contacts.length, 0);
  assert.equal(result.sweeps[1].contacts.length, 0);
  assert.ok(result.sweeps[1].boundary_candidates.length > 0);
});

test('degenerate elements, nonfinite coordinates, and drifting pins are flagged', () => {
  const mesh = fixture(a, [0]);
  assert.equal(classifyGeometry(mesh, [0, 0, 0, 1, 0, 0, 2, 0, 0], [], settings).status, 'invalid');
  assert.equal(classifyGeometry(mesh, [NaN, ...mesh.reference.slice(1)], [], settings).status, 'unresolved');
  const drift = classifyGeometry(mesh, [0, 0, 1e-6, ...mesh.reference.slice(3)], [], settings);
  assert.equal(drift.status, 'invalid');
  assert.equal(drift.attachment_drift_m, 1e-6);
});

test('welded ridge and pinned page attachments exempt only their shared features', () => {
  const mesh = fixture([...a, [0, 0, 1]], [0, 1]);
  mesh.triangles.push({ ids: [1, 0, 3], panel: 1 });
  const clean = [0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1];
  assert.equal(classifyGeometry(mesh, clean, [page], settings).status, 'valid');
  const overlap = [...a.flat(), 0.25, 0.25, 0];
  const hit = classifyGeometry(mesh, overlap, [page], settings);
  assert.equal(hit.status, 'invalid');
  assert.ok(hit.sweeps[1].contacts.some(entry => entry.category === 'between_panels'));
  assert.ok(hit.sweeps[1].contacts.some(entry => entry.category === 'panel_page'));
  const within = { ...mesh, triangles: mesh.triangles.map(t => ({ ...t, panel: 0 })) };
  assert.ok(classifyGeometry(within, overlap, [], settings).sweeps[1].contacts
    .some(entry => entry.category === 'within_panel'));
  assert.deepEqual(classifyGeometry(mesh, overlap, [page], settings), hit);
});

test('agreement across tolerances cannot confirm a plane slice outside the finite face', () => {
  const sliceAt = x => [[x, 0.25, -0.1], [x, 0.25, 0.1], [x, 0.5, 0]];
  for (const tolerance of [1e-9, 1e-8, 1e-7]) {
    const near = finitePageContact(sliceAt(-5e-12), a, tolerance, [], 1e-14);
    assert.equal(near.kind, 'boundary-candidate');
    const inside = finitePageContact(sliceAt(5e-12), a, tolerance, [], 1e-14);
    assert.equal(inside.kind, 'noncoplanar-contact');
    assert.ok(inside.points_m.every(([x,, z]) => x > 0 && z === 0));
    assert.equal(finitePageContact(sliceAt(-0.01), a, tolerance).kind, 'disjoint');
  }
});

test('a boundary-only page candidate leaves the geometry ambiguous at every tolerance', () => {
  const result = classify([[-5e-12, 0.25, -0.1], [-5e-12, 0.25, 0.1], [-5e-12, 0.5, 0]]);
  assert.equal(result.status, 'ambiguous');
  assert.ok(result.sweeps.every(s => s.contacts.length === 0 && s.boundary_candidates.length > 0));
});

test('near-edge slices inside the roundoff band remain candidates on either side', () => {
  const roundoff = 64 * Number.EPSILON * 0.145;
  const sliceAt = x => [[x, 0.25, -0.1], [x, 0.25, 0.1], [x, 0.5, 0]];
  for (const tolerance of [1e-9, 1e-8, 1e-7]) {
    for (const x of [-1e-15, 1e-15, -5e-12]) {
      assert.equal(finitePageContact(sliceAt(x), a, tolerance, [], roundoff).kind, 'boundary-candidate');
    }
    assert.equal(finitePageContact(sliceAt(5e-12), a, tolerance, [], roundoff).kind, 'noncoplanar-contact');
  }
});

test('tangential and coplanar contact require overlap in the finite face interior', () => {
  const roundoff = 64 * Number.EPSILON;
  const kind = panel => finitePageContact(panel, a, eps, [], roundoff).kind;
  assert.equal(kind([[0.2, 0.2, 0], [0.3, 0.2, 1], [0.2, 0.3, 1]]), 'boundary-candidate');
  assert.equal(kind([[0.2, 0.2, 0], [0.3, 0.2, 0], [0.2, 0.3, 1]]), 'noncoplanar-contact');
  assert.equal(kind([[0.2, 0.2, 0], [0.4, 0.2, 0], [0.2, 0.4, 0]]), 'coplanar-contact');
  assert.equal(kind([[0, 0, 0], [-0.3, 0.2, 0], [0, 0.5, 0]]), 'boundary-candidate');
  assert.equal(kind(a.map(([x, y]) => [x, y, 1e-15])), 'boundary-candidate');
});
