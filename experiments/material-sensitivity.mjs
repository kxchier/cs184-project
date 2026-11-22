import { readFileSync, writeFileSync } from 'node:fs';
import { buildMesh, defaultMaterial, defaultSolver, equilibrium, makeReport, reportCSV } from '../viewer/flexible.js';

const config = JSON.parse(readFileSync(new URL('../configs/baseline.json', import.meta.url)));
const angle = 90;
const gravity = [0, 0, -9.81];
const masses = [defaultMaterial.mass_per_area_kg_m2, 2 * defaultMaterial.mass_per_area_kg_m2];
const stiffnesses = [2e-6, 2e-5];
const resolutions = [4, 8];
const reports = [];

for (const mass of masses) {
  for (const stiffness of stiffnesses) {
    for (const resolution of resolutions) {
      const material = { ...defaultMaterial, mass_per_area_kg_m2: mass, bending_stiffness_N_m: stiffness };
      const mesh = buildMesh(config, angle, resolution);
      const start = performance.now();
      const result = equilibrium(mesh, material, defaultSolver, gravity);
      const time = performance.now() - start;
      reports.push(makeReport(config, angle, mesh, material, defaultSolver, result, time, gravity));
    }
  }
}

const write = (extension, data) => writeFileSync(
  new URL('../results/material-sensitivity.' + extension, import.meta.url), data,
);
write('json', JSON.stringify(reports, null, 2) + '\n');
write('csv', reportCSV(reports));
