import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { solve } from '../viewer/model.js';

const baseline = JSON.parse(readFileSync(new URL('../configs/baseline.json', import.meta.url)));
test('JavaScript agrees with Python across angles and geometries to 1e-12 metres', () => {
  const configs = [baseline, { ...baseline, geometry: {
    attachment_length_m: 0.12, ridge_length_m: 0.065, crease_angle_deg: 47.5,
  } }];
  const angles = [0, 0.001, 12.5, 30, 60, 90, 92.75, 120, 150, 179.999, 180];
  const cases = configs.flatMap(config => angles.map(angle => ({ config, angle })));
  const python = JSON.parse(execFileSync('python3', ['-c',
    'import json,sys; from vfold.model import solve; print(json.dumps([solve(c["config"], c["angle"]) for c in json.load(sys.stdin)]))'],
  { cwd: new URL('..', import.meta.url), input: JSON.stringify(cases), encoding: 'utf8' }));
  cases.forEach(({ config, angle }, i) => {
    const js = solve(config, angle);
    assert.equal(js.opening_angle_deg, python[i].opening_angle_deg);
    for (const [name, point] of Object.entries(js.landmarks_m)) {
      point.forEach((value, axis) => assert.ok(
        Math.abs(value - python[i].landmarks_m[name][axis]) < 1e-12,
        `${name}, axis ${axis}, angle ${angle}`));
    }
  });
});

test('JavaScript rejects invalid angles and unsupported material behavior', () => {
  for (const angle of [-1, 181, NaN, Infinity]) assert.throws(() => solve(baseline, angle));
  assert.throws(() => solve({ ...baseline, material: { stiffness: 1 } }, 90));
});
