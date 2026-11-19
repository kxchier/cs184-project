# Research plan

We want to find out which material effects help predict real V-fold shapes at
different book angles. The viewer helps us inspect the models.

## Models to compare

1. Rigid panels with ideal hinges: our baseline.
2. Flexible panels with ideal hinges: implemented using quadratic bending and
   a stretching penalty. See [the model notes](flexible-model.md).
3. Flexible panels with elastic creases: planned, not implemented.

## Calibrate separately

Use separate specimens to measure panel bending, stretching, and eventually
crease moment versus angle. Record specimen dimensions, thickness, grain
direction, humidity, loading rate, repeated trials, and measurement uncertainty.
Check that the tests can actually distinguish the parameters being fitted.

Choose and freeze the parameters using these tests. Then evaluate on pop-ups
that were not used for calibration, including different geometries. Testing
only new angles on a fitted prototype is not enough.

## Compare with prototypes

Mark O, L, R, C and points inside the panels. Surface scans could capture bending
that a few landmarks miss. Choose the angle sequence in advance and repeat the
measurements. Record the specimen and trial IDs, actual opening angle and its
uncertainty, opening/closing direction, and time allowed to settle.

Use fixed fixture markers to align measured and simulated coordinates. Use the
same alignment for all models. Save raw measurements, the alignment transform,
configuration ID, and acquisition details. Store positions in metres and compare
predictions at the measured angles.

For each landmark, measure the distance between its predicted and measured
position. Report errors by angle and landmark, plus maximum error and:

    RMSE = sqrt(sum(||prediction − measurement||²) / N)

For surface comparisons, use matching points when possible. If using distances
to the nearest surface, explain the sampling and its limitations. Report trial
variation, measurement uncertainty, and uncertainty in the fitted parameters.
Summarize results by prototype so one densely sampled specimen does not dominate.
Keep opening and closing results separate if the shapes depend on loading history.

Decide acceptable errors before evaluation. Judge added physics by how much it
reduces errors on unseen prototypes, compared with measurement uncertainty.
Report failures and computation time too. Check contact, page bending, and
construction errors before assuming every mismatch comes from paper stiffness.
