import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as shared from '../geometry/geometry-validity.js';
import * as runner from '../experiments/geometry-validity.mjs';
import { buildMesh, defaultMaterial, equilibrium } from '../viewer/flexible.js';
import { buildButterflyMesh } from '../viewer/butterfly-mesh.js';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const data = read('../results/geometry-validity.json');
const config = data.config;

test('the browser surface is import-free and the Node API re-exports the same functions', () => {
  const source = readFileSync(new URL('../geometry/geometry-validity.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:import|process|Buffer|require|fetch|window|document)\b/);
  assert.deepEqual(Object.keys(shared), ['bookPages', 'classifyGeometry', 'finitePageContact', 'triangleContact']);
  assert.deepEqual(Object.keys(runner), Object.keys(shared));
  for (const key of Object.keys(shared)) assert.equal(runner[key], shared[key]);
});

test('finite-face contact and attachment exemptions hold through both import routes', () => {
  const face = [[0,0,0], [1,0,0], [0,1,0]];
  const crossing = [[.2,.2,-1], [.2,.2,1], [.2,.6,0]];
  const edge = [[0,0,0], [.6,0,0], [.2,.2,1]];
  const leaking = [[0,0,0], [.2,.2,-1], [.2,.6,1]];
  const overlap = [[.1,.1,0], [.5,.1,0], [.1,.5,0]];
  const outside = x => [[x,.2,-1], [x,.2,1], [x,.4,0]];
  for (const api of [shared, runner]) {
    const hit = (triangle, allowed = []) => api.finitePageContact(triangle, face, 1e-8, allowed, 1e-14).kind;
    assert.equal(hit(crossing), 'noncoplanar-contact');
    assert.equal(hit(edge), 'boundary-candidate');
    assert.equal(hit(edge, edge.slice(0,2)), 'allowed');
    assert.equal(hit(leaking, [edge[0]]), 'noncoplanar-contact');
    assert.equal(hit(overlap), 'coplanar-contact');
    assert.equal(hit([[.1,.1,0], [.3,.1,1], [.1,.3,1]]), 'boundary-candidate');
    assert.equal(hit([[0,0,0], [-1,0,1], [0,-1,1]], [face[0]]), 'allowed');
    assert.equal(hit(outside(-1e-12)), 'boundary-candidate');
    assert.equal(hit(outside(-.1)), 'disjoint');
    assert.equal(api.triangleContact([[0,0,0], [1,0,0], [2,0,0]], face, 1e-8).kind, 'degenerate');
    assert.equal(api.triangleContact([[0,0,0], [1,0,NaN], [0,1,0]], face, 1e-8).kind, 'nonfinite');
  }
});

test('both import routes reproduce all committed MD3 diagnostics exactly', () => {
  const pages = shared.bookPages(config, 120);
  assert.deepEqual(pages, data.pages_m);
  for (const row of data.cases) {
    const mesh = buildMesh(config, row.angle_deg, row.resolution);
    const result = shared.classifyGeometry(mesh, row.positions_m, pages, data.tolerances);
    assert.deepEqual(result, runner.classifyGeometry(mesh, row.positions_m, pages, data.tolerances));
    for (const key of Object.keys(result)) assert.deepEqual(result[key], row[key], row.id + ' ' + key);
  }
});

test('both routes diagnose the actual butterfly equilibria and flag panel overlaps', () => {
  for (const angle of [60,90]) for (const level of [0,1]) {
    const mesh = buildButterflyMesh(config, angle, level);
    const pages = shared.bookPages(config, angle);
    const check = (x, api = shared) => api.classifyGeometry(mesh, x, pages, data.tolerances);
    for (const g of [0,-9.81]) {
      const solved = equilibrium(mesh, defaultMaterial, data.solver_settings, [0,0,g]);
      assert.equal(solved.converged, true);
      const result = check(solved.positions);
      assert.equal(result.status, 'valid');
      assert.deepEqual(result, check(solved.positions, runner));
    }
    if (level !== 0) continue;
    const fore = mesh.markers.find(m => m.name === 'left_forewing').ids[0];
    const hind = mesh.markers.find(m => m.name === 'left_hindwing').ids[0];
    const folded = [...mesh.reference];
    folded.splice(3*fore, 3, ...folded.slice(3*hind, 3*hind+3));
    const overlap = [...mesh.reference];
    for (const id of mesh.boundaries[0]) if (!mesh.pins.includes(id)) overlap[3*id] *= -1;
    for (const [x, category] of [[folded,'within_panel'], [overlap,'between_panels']]) {
      const result = check(x);
      assert.ok(result.sweeps[1].contacts.some(h => h.category === category));
      assert.deepEqual(result, check(x, runner));
    }
  }
});
