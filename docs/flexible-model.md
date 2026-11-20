# Flexible panel model

The flexible model starts from the rigid V-fold shape and lets gravity bend the
panels. The page attachment edges stay fixed. The panel interiors, free edges,
and shared ridge can move.

The implementation is in `viewer/flexible.js`, used by the viewer, tests, and
batch experiments. The Python rigid solver is unchanged. Material values are
illustrative; we have not calibrated or checked them against real paper.

## Bending and stretching

We use the quadratic bending model from Bergou, Wardetzky, Harmon, Zorin and
Grinspun, [A Quadratic Bending Model for Inextensible Surfaces (2006)](https://www.cs.columbia.edu/cg/pdfs/9-QuadBend.pdf).
Their [project page](https://www.cs.columbia.edu/cg/quadratic/) has examples and code.

This model computes bending from the mesh's original lengths and angles. That
operator stays fixed while the panel moves, so it works best when stretching is
small. We add a St. Venant–Kirchhoff (StVK) membrane energy to resist stretching.
It allows some stretch rather than enforcing perfectly fixed lengths.

### Stretching energy

For each triangle, A is its original area (m²), Dm is its 2D reference edge matrix
(m), and Ds is its current 3×2 edge matrix (m). Define:

    F = Ds Dm⁻¹
    E = (FᵀF − I)/2
    Es = Σtriangles A [μ tr(E²) + (λ/2) tr(E)²]
    μ = Y2D / [2(1 + ν)]
    λ = Y2D ν / (1 − ν²)

Y2D is the stretching modulus in N/m. ν is Poisson ratio, with a plane-stress
convention. The gradient uses P = F[2μE + λ tr(E) I]. This energy is unchanged
by rigid rotation, but is unreliable under large strain, compression, or
triangle inversion. Reported edge strains help spot problems; they do not detect
every inverted triangle.

### Bending energy

For two triangles ijk and ijl sharing an edge inside one panel, ci and cj are
cotangents at i and j in triangle ijk; di and dj are the corresponding cotangents
in ijl. All are measured in the reference geometry.

    K = [cj+dj, ci+di, −ci−cj, −di−dj]
    Q = 3/(Aijk + Aijl) KᵀK
    Eb = (D/2) Σedges Σaxis xaxisᵀ Q xaxis

D is bending stiffness in N·m, K is dimensionless, and Q has units m⁻². Each
panel starts flat, with zero rest curvature. The energy uses its reference
lengths and areas; it does not pull vertices toward their rigid positions.

### Gravity and parameters

    Eg = −Σvertices mi g·xi
    mi = ρA Σincident triangles A/3

ρA is mass per area in kg/m². Each triangle's mass is split equally among its
vertices. Gravity is (0,0,−9.81) m/s², with +z up and the spine horizontal, as in
the [rigid model](model.md). Energies are in joules and position gradients in newtons.

| Parameter | Default | Unit |
|---|---|---|
| Mass per area ρA | 0.08 | kg/m² |
| Bending stiffness D | 0.00002 | N·m |
| Stretching modulus Y2D | 100 | N/m |
| Poisson ratio ν | 0.3 | dimensionless |

These settings are independent. They were not measured from a particular paper
or calculated from its thickness.

### B-flute cardboard preset

The preset uses 5.158 N·m from the mean machine-direction B-flute bending
stiffness in Table 3 of [Mrówczyński et al. (2023)](https://doi.org/10.15376/biores.18.4.7611-7628).
The stretching modulus is estimated as 2.53 × 10⁶ N/m by summing Young's
modulus times thickness for the two flat liners in Table 2. Mass per area is
0.450 kg/m², from a [comparable B-flute product](https://packhelp.com/help/topic/paperboard-use-manufacture-mailer-boxes/).
The nominal 3.2 mm thickness is descriptive. The solver applies the effective
stiffnesses in all directions and treats the panels as zero-thickness sheets.

## Mesh and folds

Each panel is divided into n² triangles. The two panels share the same vertex
IDs along the ridge, so they cannot separate there. All vertices on O–L and O–R
are fixed to the pages. Every other vertex is free in 3D, including the ridge
except for O. We do not enforce symmetry on the free vertices.

Bending energy applies only inside each panel. There is no bending term across
the ridge or between a panel and page: those folds are ideal hinges with no
crease resistance. Free edges have no extra constraints.

We keep O, L, R, and C, and add IL/IR at the panel centres and FL/FR halfway along
the free edges. Their material coordinates are:

    x = (1−u−v)O + u(L or R) + vC
    IL/IR: u = v = 1/3
    FL/FR: u = v = 1/2

Positions are interpolated from the surrounding mesh triangle, so changing mesh
resolution still measures the same locations on the paper.

## Finding a settled shape

At a fixed book angle, the solver minimizes Es + Eb + Eg over the free vertices
using L-BFGS and analytic gradients. It uses 12 history pairs and Armijo line
search: start at step 1, halve as needed, allow 40 attempts, and use coefficient
0.0001. Unusable curvature pairs are skipped. A direction that would increase
energy resets the history and falls back to scaled steepest descent.
Fixed attachment vertices never move during the solve.

The solver reports convergence when:

    max over free vertices (|∂E/∂xi| / Ai) ≤ 0.005 N/m²

Ai is the vertex's share of the original triangle areas. Dividing by area makes
the force test less dependent on mesh resolution. The limit is 6000 iterations.
If the residual is still too high, the result is marked unconverged, including
when line search fails. Small motion alone is not enough to pass.

Each solve starts from the rigid raised shape. This finds a local equilibrium,
not necessarily the lowest-energy shape, and it may leave the initial branch.
The browser yields every 25 iterations and cancels old solves when settings
change. These iterations find a static shape; they do not represent physical time.

## Exports and checks

JSON saves the configuration, angle, material values, gravity, mesh resolution,
solver settings, convergence, timing, mesh connections, and reference/deformed
vertex positions. JSON and CSV both save the eight landmarks and their reference
positions, deformed positions, and displacement magnitudes. CSV repeats the
geometry and solve settings for each marker. The original Python rigid exports
are still available; viewer exports use the selected model.

We report maximum vertex displacement and area-weighted RMS displacement from
the rigid shape. Stretching error is the RMS and maximum absolute relative
edge-length change over unique mesh edges. Time covers the solver only and
varies by machine. These are numerical checks, not errors against real paper.
See the [batch results](../results/milestone.md) for the 16-case comparison.

## Limits

There is no contact or intersection detection. Panels can pass through the
pages or each other, especially at extreme angles or soft settings. A converged
solve does not mean the shape is free of intersections.

The model also leaves out thickness, grain direction, plasticity, time-dependent
material behavior, crease resistance, friction, page bending, and glue flexibility.
The bending approximation is most useful at small strains. Mesh checks and
stiffness tests do not replace separate material calibration and measurements
on unseen physical prototypes. We do not claim novelty or calibrated accuracy.
