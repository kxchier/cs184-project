import { buildButterflyMesh } from './butterfly-mesh.js';
import { defaultMaterial, defaultSolver, equilibrium, sampleMarkers } from './flexible.js';
import { bookPages, classifyGeometry } from '../geometry/geometry-validity.js';

export const tolerances = Object.freeze({ distance_m: 1e-8, attachment_m: 1e-11, relative_area: 1e-6 });

function crossesPage(contact, mesh, positions, pages, roundoff) {
  if (contact.category !== 'panel_page' || contact.kind !== 'noncoplanar-contact') return false;
  const [triangle, page] = contact.ids;
  const [origin, outer] = pages[page];
  const dx = outer[0] - origin[0];
  const dz = outer[2] - origin[2];
  // The page spans its outer edge direction in x-z and the book spine in y.
  const length = Math.hypot(dx, dz);
  const distances = mesh.triangles[triangle].ids.map(id =>
    (dz * (positions[3 * id] - origin[0]) - dx * (positions[3 * id + 2] - origin[2])) / length);
  return Math.min(...distances) < -roundoff && Math.max(...distances) > roundoff;
}

const multipliers = [0.1, 1, 10];
const nonnegative = value => Number.isFinite(value) && value >= 0;
const indexIn = (value, count) => Number.isInteger(value) && value >= 0 && value < count;
const pairKey = hit => JSON.stringify([hit.category, hit.ids, hit.kind]);

function validRecord(hit, boundary, triangleCount, pageCount) {
  const page = hit?.category === 'panel_page';
  const panel = ['within_panel', 'between_panels'].includes(hit?.category);
  return (page || panel) && Array.isArray(hit.ids) &&
    hit.ids.length === (page ? 3 : 2) && indexIn(hit.ids[0], triangleCount) &&
    (page ? indexIn(hit.ids[1], pageCount) && indexIn(hit.ids[2], 2) : indexIn(hit.ids[1], triangleCount)) &&
    (boundary ? page && hit.kind === 'boundary-candidate'
      : ['coplanar-contact', 'noncoplanar-contact'].includes(hit.kind)) &&
    Array.isArray(hit.points_m) && hit.points_m.length > 0 &&
    hit.points_m.every(point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite));
}

function consistentReport(geometry, sweeps) {
  const degenerate = geometry.degenerate_triangles.length > 0;
  if (degenerate !== (geometry.minimum_relative_area <= tolerances.relative_area) ||
      new Set(geometry.degenerate_triangles).size !== geometry.degenerate_triangles.length) return false;

  const nominal = sweeps.find(sweep => sweep.multiplier === 1);
  const signature = records => JSON.stringify(records.map(pairKey));
  const varies = field => sweeps.some(sweep => signature(sweep[field]) !== signature(nominal[field]));
  const contactsVary = varies('contacts');
  const attachmentViolation = geometry.attachment_drift_m > tolerances.attachment_m;
  // Match the checker's overall status contract before assigning a viewer headline.
  const expectedStatus = attachmentViolation || degenerate ? 'invalid'
    : contactsVary ? 'ambiguous'
    : nominal.contacts.length > 0 ? 'invalid'
    : sweeps.some(sweep => sweep.boundary_candidates.length > 0) ? 'ambiguous' : 'valid';
  return geometry.status === expectedStatus &&
    geometry.tolerance_sensitive === (contactsVary || varies('boundary_candidates'));
}

function summarizeGeometry(geometry, mesh, positions, pages) {
  const sweeps = Array.isArray(geometry?.sweeps) ? geometry.sweeps : [];
  const expectedSweeps = sweeps.length === multipliers.length &&
    multipliers.every(multiplier => sweeps.filter(sweep => sweep?.multiplier === multiplier).length === 1);
  let complete = expectedSweeps && ['valid', 'invalid', 'ambiguous'].includes(geometry.status) &&
    typeof geometry.tolerance_sensitive === 'boolean' && nonnegative(geometry.page_roundoff_m) &&
    nonnegative(geometry.attachment_drift_m) && nonnegative(geometry.minimum_relative_area) &&
    Array.isArray(geometry.degenerate_triangles) &&
    geometry.degenerate_triangles.every(id => indexIn(id, mesh.triangles.length));
  const reports = [];
  for (const sweep of sweeps) {
    const multiplier = multipliers.includes(sweep?.multiplier) ? sweep.multiplier : null;
    for (const [field, boundary] of [['contacts', false], ['boundary_candidates', true]]) {
      if (!Array.isArray(sweep?.[field])) {
        complete = false;
        continue;
      }
      for (const hit of sweep[field]) {
        if (!validRecord(hit, boundary, mesh.triangles.length, pages.length)) {
          complete = false;
          continue;
        }
        reports.push({ ...hit, multiplier });
      }
    }
  }

  const contactRecords = reports.map(hit => {
    const boundary = hit.kind === 'boundary-candidate';
    const stable = !boundary && expectedSweeps && multipliers.every(multiplier =>
      reports.some(record => record.multiplier === multiplier && pairKey(record) === pairKey(hit)));
    const confidence = boundary ? 'boundary candidate' : stable ? 'confirmed'
      : complete ? 'tolerance-dependent' : 'incomplete check';
    const transverse = !boundary && nonnegative(geometry.page_roundoff_m) &&
      crossesPage(hit, mesh, positions, pages, geometry.page_roundoff_m);
    const type = boundary ? 'Boundary candidate' : transverse ? 'Transverse page crossing'
      : hit.kind === 'coplanar-contact' ? 'Coplanar contact' : 'Noncoplanar contact';
    const scope = hit.multiplier === null ? 'tolerance unknown'
      : hit.multiplier === 1 ? '1× nominal tolerance' : hit.multiplier + '× tolerance';
    return { ...hit, confidence, label: type + ' · ' + hit.category + ' [' + hit.ids.join(', ') + '] · ' +
      scope + ' · ' + confidence };
  });
  complete = complete && consistentReport(geometry, sweeps);
  const attachmentViolation = complete && geometry.attachment_drift_m > tolerances.attachment_m;
  const confirmed = contactRecords.some(hit => hit.confidence === 'confirmed') ||
    (complete && (attachmentViolation || geometry.degenerate_triangles.length > 0));
  const uncertain = geometry?.status === 'ambiguous' || Boolean(geometry?.tolerance_sensitive) ||
    contactRecords.some(hit => hit.confidence !== 'confirmed');
  const contactStatus = !complete ? 'Geometric check unavailable'
    : confirmed ? 'Detected geometric violation'
    : uncertain ? 'Unresolved contact candidate' : 'No violation detected by the tested checks';

  return { complete, contactRecords, attachmentViolation, confirmed, uncertain, contactStatus };
}

export function butterflyState(config, selection, { solve = equilibrium, diagnose = classifyGeometry } = {}) {
  const { angle, level, gravity, flexible } = selection;
  if (![60, 90].includes(angle) || ![0, 1].includes(level) ||
      typeof gravity !== 'boolean' || typeof flexible !== 'boolean') {
    throw new RangeError('Unsupported butterfly configuration');
  }

  const mesh = buildButterflyMesh(config, angle, level);
  const pages = bookPages(config, angle);
  const material = { ...defaultMaterial };
  const gravity_m_s2 = [0, 0, gravity ? -9.81 : 0];
  let positions = mesh.reference;
  let solver = { status: 'reference' };
  if (flexible) {
    try {
      const { positions: solved, converged, reason, iterations, residual_N_m2, energy_J } =
        solve(mesh, material, defaultSolver, gravity_m_s2);
      const usable = converged === true && solved?.length === positions.length && solved.every(Number.isFinite) &&
        [iterations, residual_N_m2, energy_J].every(Number.isFinite);
      solver = { status: usable ? 'converged' : 'failed',
        reason: converged && !usable ? 'Malformed solver result' : reason, iterations, residual_N_m2, energy_J };
      if (usable) positions = solved;
    } catch (error) {
      solver = { status: 'failed', reason: error.message };
    }
  }

  let geometry;
  try {
    geometry = diagnose(mesh, positions, pages, tolerances);
  } catch (error) {
    geometry = { status: 'unresolved', reason: error.message };
  }

  return {
    selection: { ...selection }, mesh, pages, positions, material, gravity_m_s2, solver, geometry,
    ...summarizeGeometry(geometry, mesh, positions, pages),
    vertexCount: positions.length / 3, triangleCount: mesh.triangles.length,
    landmarks_m: sampleMarkers(mesh, positions),
    referenceLandmarks_m: sampleMarkers(mesh, mesh.reference),
  };
}
