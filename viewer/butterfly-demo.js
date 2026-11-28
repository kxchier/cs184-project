import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { butterflyState } from './butterfly-state.js';

const response = await fetch(new URL('../configs/baseline.json', import.meta.url));
if (!response.ok) throw new Error('Could not load baseline configuration');
const config = await response.json();

const viewport = document.querySelector('#viewport');
const form = document.querySelector('#configuration');
const reset = document.querySelector('#reset');
const status = document.querySelector('#status');
const issue = document.querySelector('#issue');
const measurements = document.querySelector('#measurements');
const contact = document.querySelector('#contact');
const details = document.querySelector('#contact-details');
const records = document.querySelector('#records');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x26364a);
const camera = new THREE.PerspectiveCamera(37, 1, 0.002, 10);
camera.up.set(0, 0, 1);
camera.position.set(0.10, 0.42, 0.31);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewport.append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.065, 0.065);
controls.minDistance = 0.08;
controls.maxDistance = 1.5;
controls.update();
controls.saveState();
const render = () => renderer.render(scene, camera);
controls.addEventListener('change', render);
reset.addEventListener('click', () => controls.reset());
new ResizeObserver(() => {
  if (!viewport.clientWidth || !viewport.clientHeight) return;
  renderer.setSize(viewport.clientWidth, viewport.clientHeight, false);
  camera.aspect = viewport.clientWidth / viewport.clientHeight;
  camera.zoom = Math.min(camera.aspect / 0.85, 1);
  camera.updateProjectionMatrix();
  controls.zoom0 = camera.zoom;
  render();
}).observe(viewport);

scene.add(new THREE.HemisphereLight(0xf5f8ff, 0x8597aa, 2.1));
const key = new THREE.DirectionalLight(0xfff2e5, 2.2);
key.position.set(-0.2, -0.1, 0.4);
scene.add(key);
const wingMaterials = [0xd38d65, 0xbe6f70].map(color =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.82, side: THREE.DoubleSide }));
const pageMaterial = new THREE.MeshStandardMaterial({
  color: 0x8a9caf, roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.46, depthWrite: false,
});
const pageEdge = new THREE.LineBasicMaterial({ color: 0xb7c5d7 });
const boundary = new THREE.LineBasicMaterial({ color: 0xffe8d8 });
const attachment = new THREE.LineBasicMaterial({ color: 0x58e0cb });
const ridge = new THREE.LineBasicMaterial({ color: 0xffd45e });
const witness = new THREE.PointsMaterial({ color: 0xff4949, size: 0.005, depthTest: false });
const candidateWitness = new THREE.PointsMaterial({ color: 0xffaf34, size: 0.004, depthTest: false });
const objects = new THREE.Group();
scene.add(objects);

function surface(positions, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function drawLine(positions, material, closed = false) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  objects.add(closed ? new THREE.LineLoop(geometry, material) : new THREE.Line(geometry, material));
}

function clearGeometry() {
  for (const object of [...objects.children]) {
    objects.remove(object);
    object.geometry.dispose();
  }
}

function drawState(state) {
  const { mesh, positions, pages } = state;
  const chain = ids => ids.flatMap(id => Array.from(positions.slice(3 * id, 3 * id + 3)));
  for (const page of pages) {
    const vertices = page.flat();
    objects.add(new THREE.Mesh(surface(vertices, [0, 1, 2, 0, 2, 3]), pageMaterial));
    drawLine(vertices, pageEdge, true);
  }
  // Keep a normal discontinuity at the welded fold while retaining global mesh vertex IDs.
  for (const [panel, material] of wingMaterials.entries()) {
    const indices = mesh.triangles.filter(face => face.panel === panel).flatMap(face => face.ids);
    objects.add(new THREE.Mesh(surface(positions, indices), material));
  }
  for (const ids of mesh.boundaries) drawLine(chain(ids), boundary, true);
  for (const ids of mesh.attachments) drawLine(chain(ids), attachment);
  drawLine(chain(mesh.ridge), ridge);
  const confirmed = state.contactRecords.filter(hit => hit.confidence === 'confirmed');
  const uncertain = state.contactRecords.filter(hit => hit.confidence !== 'confirmed');
  for (const [entries, material] of [[confirmed, witness], [uncertain, candidateWitness]]) {
    if (!entries.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(entries.flatMap(hit => hit.points_m.flat()), 3));
    const points = new THREE.Points(geometry, material);
    points.renderOrder = 10;
    objects.add(points);
  }
}

function present(state) {
  const { selection, solver, material, geometry } = state;
  status.textContent = {
    reference: 'Rigid reference', failed: 'Numerical solve failed', converged: 'Converged static equilibrium',
  }[solver.status];
  const notes = [];
  if (solver.status === 'failed') notes.push('Showing rigid reference. Attempt metadata below. ' + (solver.reason ?? ''));
  if (geometry?.reason) notes.push(geometry.reason);
  if (!state.complete && !geometry?.reason) notes.push('Diagnostic report incomplete or malformed.');
  else if (state.confirmed && state.uncertain) notes.push('Unresolved contact candidate');
  if (state.attachmentViolation) notes.push('Attachment drift exceeds the attachment tolerance.');
  if (geometry?.tolerance_sensitive) notes.push('Classification varies across tolerances.');
  if (geometry?.degenerate_triangles?.length) notes.push('Degenerate elements detected.');
  issue.textContent = notes.join(' ');
  issue.hidden = !notes.length;
  const number = value => Number.isFinite(value) ? value.toExponential(5) : '—';
  const shift = 1000 * Math.max(...Object.entries(state.landmarks_m).map(([name, point]) =>
    Math.hypot(...point.map((value, axis) => value - state.referenceLandmarks_m[name][axis]))));
  const rows = [
    ['Opening angle', selection.angle + '°'],
    ['Displayed geometry', solver.status === 'converged' ? 'Flexible equilibrium' : 'Rigid reference'],
    ['Mesh level', selection.level ? 'Refined (1)' : 'Coarse (0)'],
    ['Vertices / triangles', state.vertexCount + ' / ' + state.triangleCount],
    ['Gravity z (m/s²)', state.gravity_m_s2[2]],
    ['Areal mass (kg/m²)', material.mass_per_area_kg_m2],
    ['Bending stiffness (N·m)', material.bending_stiffness_N_m],
    ['Stretching modulus (N/m)', material.stretching_modulus_N_m],
    ['Poisson ratio', material.poisson_ratio],
    ['Iterations', solver.iterations ?? '—'],
    ['Force residual (N/m²)', number(solver.residual_N_m2)],
    ['Final energy (J)', number(solver.energy_J)],
    ['Maximum lobe shift (mm)', shift.toFixed(3)],
  ];
  measurements.replaceChildren(...rows.flatMap(([label, value]) => {
    const term = document.createElement('dt');
    const definition = document.createElement('dd');
    term.textContent = label;
    definition.textContent = value;
    return [term, definition];
  }));
  contact.textContent = state.contactStatus;
  records.replaceChildren(...state.contactRecords.map(hit => {
    const item = document.createElement('li');
    item.textContent = hit.label;
    return item;
  }));
  details.hidden = !state.contactRecords.length;
}

function update() {
  clearGeometry();
  try {
    const selection = {
      angle: Number(form.elements.angle.value),
      level: Number(form.elements.level.value),
      gravity: form.elements.gravity.value === 'on',
      flexible: form.elements.mode.value === 'flexible',
    };
    const state = butterflyState(config, selection);
    drawState(state);
    present(state);
  } catch (error) {
    clearGeometry();
    status.textContent = 'Viewer state unavailable';
    issue.textContent = error.message;
    issue.hidden = false;
    measurements.replaceChildren();
    contact.textContent = 'Geometric check unavailable';
    details.hidden = true;
    records.replaceChildren();
  }
  render();
}

form.addEventListener('change', update);
form.addEventListener('submit', event => event.preventDefault());
for (const control of form.elements) control.disabled = false;
reset.disabled = false;
update();
