const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = ([a, b, c], [x, y, z]) => [b * z - c * y, c * x - a * z, a * y - b * x];
const length = v => Math.hypot(...v);
const scale = (v, s) => v.map(x => x * s);
const interpolate = (a, b, t) => a.map((x, i) => x + t * (b[i] - x));
const point = (x, i) => x.slice(3 * i, 3 * i + 3);
const finitePoint = p => p.length === 3 && p.every(Number.isFinite);
const normal = ([a, b, c]) => cross(sub(b, a), sub(c, a));
const edges = t => t.map((p, i) => [p, t[(i + 1) % 3]]);

function prepare(vertices) {
  const raw = normal(vertices);
  const unit = scale(raw, 1 / length(raw));
  const sides = edges(vertices).map(([a, b]) => {
    const inward = cross(unit, sub(b, a));
    return { a, unit: scale(inward, 1 / length(inward)) };
  });
  const bounds = [0, 1, 2].map(axis => {
    const values = vertices.map(p => p[axis]);
    return [Math.min(...values), Math.max(...values)];
  });
  return { vertices, unit, sides, bounds };
}

function inside(p, tri, tolerance) {
  return tri.sides.every(side => dot(side.unit, sub(p, side.a)) >= -tolerance);
}

// Clip a coplanar edge to the three inward half-planes of the triangle.
function clipEdge(a, b, tri, tolerance) {
  let first = 0;
  let last = 1;
  for (const side of tri.sides) {
    const start = dot(side.unit, sub(a, side.a));
    const end = dot(side.unit, sub(b, side.a));
    if (start < -tolerance && end < -tolerance) return [];
    if (start >= -tolerance && end >= -tolerance) continue;
    const t = Math.max(0, Math.min(1, (start + tolerance) / (start - end)));
    if (start < -tolerance) first = Math.max(first, t);
    else last = Math.min(last, t);
    if (first > last) return [];
  }
  return [interpolate(a, b, first), interpolate(a, b, last)];
}

function edgeContacts(source, target, tolerance) {
  const contacts = [];
  for (const [a, b] of edges(source.vertices)) {
    const da = dot(target.unit, sub(a, target.vertices[0]));
    const db = dot(target.unit, sub(b, target.vertices[0]));
    if (Math.abs(da) <= tolerance && Math.abs(db) <= tolerance) {
      contacts.push(...clipEdge(a, b, target, tolerance));
      continue;
    }
    if (Math.abs(da) <= tolerance && inside(a, target, tolerance)) contacts.push(a);
    if (Math.abs(db) <= tolerance && inside(b, target, tolerance)) contacts.push(b);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const hit = interpolate(a, b, da / (da - db));
      if (inside(hit, target, tolerance)) contacts.push(hit);
    }
  }
  return contacts;
}

function distanceToFeature(p, feature) {
  if (feature.length === 0) return Infinity;
  const [a, b = a] = feature;
  const direction = sub(b, a);
  const squared = dot(direction, direction);
  const t = squared === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), direction) / squared));
  return length(sub(p, interpolate(a, b, t)));
}

function contact(a, b, tolerance, allowed, featureTolerance = tolerance) {
  if (a.bounds.some(([min, max], i) =>
    min > b.bounds[i][1] + tolerance || b.bounds[i][0] > max + tolerance)) return { kind: 'disjoint' };
  const points = [...edgeContacts(a, b, tolerance), ...edgeContacts(b, a, tolerance)]
    .filter((p, i, all) => all.findIndex(q => length(sub(p, q)) <= tolerance) === i);
  if (points.length === 0) return { kind: 'disjoint' };
  const offending = points.filter(p => distanceToFeature(p, allowed) > 4 * featureTolerance);
  if (offending.length === 0) return { kind: 'allowed' };
  const coplanar = b.vertices.every(p => Math.abs(dot(a.unit, sub(p, a.vertices[0]))) <= tolerance) &&
    a.vertices.every(p => Math.abs(dot(b.unit, sub(p, b.vertices[0]))) <= tolerance);
  return { kind: coplanar ? 'coplanar-contact' : 'noncoplanar-contact', points_m: offending };
}

export function triangleContact(a, b, tolerance, allowed = []) {
  if (![...a, ...b].every(finitePoint)) return { kind: 'nonfinite' };
  if ([a, b].some(t => length(normal(t)) <= tolerance ** 2)) return { kind: 'degenerate' };
  return contact(prepare(a), prepare(b), tolerance, allowed);
}

// Confirm transverse contact by clipping the entire plane slice to the finite face.
export function finitePageContact(panel, face, tolerance, allowed = [], roundoff = 0) {
  return pageContact(prepare(panel), prepare(face), tolerance, allowed, roundoff);
}

function pageContact(panel, face, tolerance, allowed, roundoff) {
  const heights = panel.vertices.map(p => dot(face.unit, sub(p, face.vertices[0])));
  const crossesPlane = Math.min(...heights) < -roundoff && Math.max(...heights) > roundoff;
  const onPlaneEdge = heights.filter(h => h === 0).length === 2;
  if (crossesPlane || onPlaneEdge) {
    const slice = [];
    for (const [i, a] of panel.vertices.entries()) {
      const j = (i + 1) % 3;
      const da = heights[i], db = heights[j];
      if (da === 0) slice.push(a);
      else if (da * db < 0) {
        slice.push(interpolate(a, panel.vertices[j], da / (da - db)));
      }
    }
    // The inward clip proves overlap even if the boundary moves within roundoff.
    const interior = slice.length === 2 ? clipEdge(...slice, face, -roundoff) : [];
    if (interior.length === 2 && length(sub(...interior)) > roundoff &&
        interior.some(p => distanceToFeature(p, allowed) > 4 * tolerance)) {
      const points = clipEdge(...slice, face, 0);
      return { kind: 'noncoplanar-contact',
        points_m: points.filter(p => distanceToFeature(p, allowed) > 4 * tolerance) };
    }
  } else if (heights.every(h => h === 0) &&
             face.vertices.every(p => dot(panel.unit, sub(p, panel.vertices[0])) === 0)) {
    // The overlap is convex. Its vertex mean supplies an interior witness for area overlap.
    const points = [...edgeContacts(panel, face, 0), ...edgeContacts(face, panel, 0)];
    if (points.length) {
      const center = [0, 1, 2].map(axis => points.reduce((sum, p) => sum + p[axis], 0) / points.length);
      const insideBoth = [panel, face].every(tri =>
        tri.sides.every(side => dot(side.unit, sub(center, side.a)) > roundoff));
      if (insideBoth) {
        const hit = contact(panel, face, 0, allowed, tolerance);
        if (hit.points_m) return hit;
      }
    }
  }
  const candidate = contact(panel, face, tolerance, allowed);
  return candidate.points_m ? { ...candidate, kind: 'boundary-candidate' } : candidate;
}

export function bookPages(config, angle) {
  const size = Math.max(config.geometry.attachment_length_m, config.geometry.ridge_length_m);
  const half = angle * Math.PI / 360;
  return [-1, 1].map(sign => {
    const x = sign * size * 1.3 * Math.sin(half);
    const z = size * 1.3 * Math.cos(half);
    return [[0, -size * 0.35, 0], [x, -size * 0.35, z],
      [x, size * 1.45, z], [0, size * 1.45, 0]];
  });
}

export function classifyGeometry(mesh, positions, pages, tolerances) {
  if (positions.length !== mesh.reference.length || !positions.every(Number.isFinite)) {
    return { status: 'unresolved', reason: 'nonfinite_or_malformed_geometry' };
  }
  const pins = new Set(mesh.pins);
  const attachment_drift_m = Math.max(0, ...mesh.pins.map(i =>
    length(sub(point(positions, i), point(mesh.reference, i)))));
  const triangles = mesh.triangles.map(({ ids, panel }, index) => {
    const vertices = ids.map(i => point(positions, i));
    const reference = ids.map(i => point(mesh.reference, i));
    const relative_area = length(normal(vertices)) / length(normal(reference));
    return { ids, panel, index, vertices, relative_area };
  });
  if (triangles.some(t => !Number.isFinite(t.relative_area))) {
    return { status: 'unresolved', reason: 'nonfinite_element_area' };
  }
  const minimum_relative_area = Math.min(...triangles.map(t => t.relative_area));
  const degenerate_triangles = triangles.filter(t => t.relative_area <= tolerances.relative_area)
    .map(t => t.index);
  const active = triangles.filter(t => t.relative_area > tolerances.relative_area)
    .map(t => ({ ...t, ...prepare(t.vertices) }));
  const pageTriangles = pages.flatMap((quad, page) => [[0, 1, 2], [0, 2, 3]].map((ids, face) =>
    ({ ...prepare(ids.map(i => quad[i])), page, face })));

  const extent = Math.max(...pages.flat(2).map(Math.abs), ...mesh.reference.map(Math.abs), 0);
  const roundoff = 64 * Number.EPSILON * extent;
  const sweeps = [0.1, 1, 10].map(multiplier => {
    const tolerance = tolerances.distance_m * multiplier;
    const contacts = [];
    const boundary_candidates = [];
    const record = (category, ids, hit) => {
      if (!hit.points_m) return;
      const entries = hit.kind === 'boundary-candidate' ? boundary_candidates : contacts;
      entries.push({ category, ids, ...hit });
    };
    for (const [i, a] of active.entries()) {
      for (let j = i + 1; j < active.length; j++) {
        const b = active[j];
        const allowed = a.ids.filter(id => b.ids.includes(id)).map(id => point(positions, id));
        record(a.panel === b.panel ? 'within_panel' : 'between_panels',
          [a.index, b.index], contact(a, b, tolerance, allowed));
      }
      for (const b of pageTriangles) {
        // A pinned reference vertex on this finite page belongs to the intended attachment.
        const allowed = a.ids.filter(id => {
          if (!pins.has(id)) return false;
          const p = point(mesh.reference, id);
          return Math.abs(dot(b.unit, sub(p, b.vertices[0]))) <= tolerances.attachment_m &&
            pageTriangles.some(face => face.page === b.page && inside(p, face, tolerances.attachment_m));
        }).map(id => point(mesh.reference, id));
        record('panel_page', [a.index, b.page, b.face], pageContact(a, b, tolerance, allowed, roundoff));
      }
    }
    return { multiplier, contacts, boundary_candidates };
  });
  const signature = entries => JSON.stringify(entries.map(({ category, ids, kind }) => [category, ids, kind]));
  const confirmedSensitive = sweeps.some(sweep => signature(sweep.contacts) !== signature(sweeps[1].contacts));
  const tolerance_sensitive = confirmedSensitive || sweeps.some(sweep =>
    signature(sweep.boundary_candidates) !== signature(sweeps[1].boundary_candidates),
  );
  const baseline = sweeps[1].contacts;
  const otherInvalid = attachment_drift_m > tolerances.attachment_m || degenerate_triangles.length > 0;
  return {
    status: otherInvalid ? 'invalid' : confirmedSensitive ? 'ambiguous' : baseline.length ? 'invalid' :
      sweeps.some(s => s.boundary_candidates.length) ? 'ambiguous' : 'valid',
    attachment_drift_m, minimum_relative_area, degenerate_triangles, tolerance_sensitive, page_roundoff_m: roundoff, sweeps,
  };
}
