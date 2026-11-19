# V-fold pop-ups

A CS184/284A prototype for comparing rigid V-fold panels with flexible paper
under gravity. Both use ideal hinges. The material values are examples, not
measurements from real paper.

## Run

Requires Node.js 18+, npm, Python 3.9+, and a WebGL-enabled browser.
From the repository root:

```sh
npm ci
npm start
```

Open [localhost:8000](http://127.0.0.1:8000); stop with Ctrl+C.
Drag to orbit, scroll to zoom. Set an exact angle, choose rigid/flexible, and
optionally show the rigid overlay. Expand material settings to change mass per
area, bending stiffness, stretching modulus, mesh resolution or gravity.
The status reports convergence or failure; JSON/CSV export the current result.
Measurements and model notes are expandable. Styling uses local Velvelyne;
[font credits](viewer/fonts/README.md).

## Checks & experiments

```sh
npm test
npm run experiment
```

Tests compare the Python and JavaScript rigid models and check the flexible
solver, fixed attachments, shared ridge, zero gravity, stiffness changes,
mesh refinement, and exports. The batch runs 60°, 90°, 120°, 150°
with two stiffnesses and two resolutions; see [results table](results/milestone.md)
and generated JSON/CSV in `results/`. The soft 150° result changes a lot with mesh resolution.
These are numerical checks, not physical validation.

## Rigid landmark exports

```sh
python3 -m vfold configs/baseline.json --angles 60 90 120 150 --output /tmp/rigid.json --csv /tmp/rigid.csv
```

Geometry: [baseline config](configs/baseline.json). All coordinates are metres,
+z is up. See [rigid conventions](docs/model.md), [flexible model & solver](docs/flexible-model.md)
and [research protocol](docs/research.md).

**Still to do:** measure material properties separately and test on new physical prototypes.
No contact/self-intersection handling, elastic creases, silhouettes or motion fitting.
