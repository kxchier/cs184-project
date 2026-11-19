// Direct port of vfold/model.py. Keep the coordinate frame in metres, z up.
export function validate(config) {
  if (config.schema_version !== 1 || config.model !== 'rigid_ideal_hinges' ||
      config.units !== 'SI' || config.frame !== 'spine_y_symmetric_pages_z_up') {
    throw new Error('Unsupported rigid baseline configuration');
  }
  const g = config.geometry;
  for (const key of ['attachment_length_m', 'ridge_length_m']) {
    if (!Number.isFinite(g?.[key]) || g[key] <= 0) throw new Error(`Invalid ${key}`);
  }
  if (!Number.isFinite(g.crease_angle_deg) || g.crease_angle_deg <= 0 || g.crease_angle_deg >= 90) {
    throw new Error('Crease angle must be between 0 and 90 degrees');
  }
  if (!config.material || Array.isArray(config.material) || Object.keys(config.material).length) {
    throw new Error('Rigid baseline requires an empty material object');
  }
}

export function solve(config, openingAngleDeg) {
  validate(config);
  if (!Number.isFinite(openingAngleDeg) || openingAngleDeg < 0 || openingAngleDeg > 180) {
    throw new Error('Opening angle must be within [0, 180] degrees');
  }
  const g = config.geometry;
  const half = openingAngleDeg * Math.PI / 360;
  const beta = g.crease_angle_deg * Math.PI / 180;
  const a = g.attachment_length_m, h = g.ridge_length_m;
  const x = a * Math.sin(beta) * Math.sin(half);
  const y = a * Math.cos(beta), z = a * Math.sin(beta) * Math.cos(half);
  const k = Math.tan(beta) * Math.cos(half);
  return {
    opening_angle_deg: openingAngleDeg,
    landmarks_m: {
      spine_origin: [0, 0, 0],
      left_wing_tip: [-x, y, z],
      right_wing_tip: [x, y, z],
      ridge_tip: [0, h * (1 - k*k) / (1 + k*k), 2*h*k / (1 + k*k)],
    },
  };
}
