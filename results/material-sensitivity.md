# Material sensitivity at 90°

How do panel mass and bending stiffness affect the static deformation of a V-fold with fixed page attachments? The sweep crosses two illustrative mass-per-area settings, two bending stiffnesses, and two mesh resolutions. The mass levels are the simulator default and twice that value.

All runs use the baseline symmetric geometry, a 90° opening, gravity of 9.81 m/s² down, a stretching modulus of 100 N/m, and Poisson ratio 0.3. The solver starts from the raised rigid solution with the same constraints and solver settings in every run. The stopping residual is 0.005 N/m².

Run `node experiments/material-sensitivity.mjs` from the repository root to regenerate the [JSON](material-sensitivity.json) and [landmark CSV](material-sensitivity.csv). Solver timings exclude mesh construction and export and vary between runs.

| Mass (kg/m²) | Bending stiffness (N·m) | Mesh n | RMS (mm) | Max (mm) | Largest landmark offset (mm) | Residual (N/m²) | Converged | Iterations | Solver time (ms) |
|---:|---:|---:|---:|---:|---:|---:|:---:|---:|---:|
| 0.08 | 2e-6 | 4 | 1.8836 | 3.8579 | 3.8579 | 0.004831 | Yes | 322 | 54.91 |
| 0.08 | 2e-6 | 8 | 1.9238 | 4.0988 | 4.0988 | 0.004571 | Yes | 925 | 258.94 |
| 0.08 | 2e-5 | 4 | 0.1517 | 0.3359 | 0.3359 | 0.003961 | Yes | 113 | 6.91 |
| 0.08 | 2e-5 | 8 | 0.1412 | 0.3238 | 0.3238 | 0.004087 | Yes | 248 | 49.11 |
| 0.16 | 2e-6 | 4 | 3.9437 | 7.7281 | 7.7281 | 0.004810 | Yes | 309 | 18.99 |
| 0.16 | 2e-6 | 8 | 5.3138 | 10.2803 | 10.2803 | 0.004623 | Yes | 1111 | 245.23 |
| 0.16 | 2e-5 | 4 | 0.3247 | 0.7166 | 0.7166 | 0.003088 | Yes | 84 | 5.06 |
| 0.16 | 2e-5 | 8 | 0.3023 | 0.6909 | 0.6909 | 0.004298 | Yes | 258 | 59.39 |

Doubling mass increased RMS deformation in all four matched comparisons, by a factor of 2.09–2.76. Increasing bending stiffness tenfold reduced RMS deformation by roughly 92–94% at each mass and resolution. These comparisons isolate parameter sensitivity at one angle.

Refining from n = 4 to n = 8 increased the softer cases' RMS deformation by 2.1% at 0.08 kg/m² and 34.7% at 0.16 kg/m². RMS deformation in the stiffer cases decreased by about 7% at both masses. The heavier, softer case warrants further refinement before treating its displacement as stable.

Meeting the residual criterion indicates that the solver found a stationary configuration within its tolerance. Two resolutions cannot establish mesh convergence. The solver can settle in a local equilibrium, models ideal hinges without contact or self-collision, and uses uncalibrated material values. The results quantify sensitivity within this constrained numerical model. Physical accuracy would require independent material measurements and comparisons with prototypes.
