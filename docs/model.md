# Rigid V-fold model

The model has two stiff triangular panels and ideal hinges. Changing the book
angle moves the panels without bending them. Gravity does not affect this model.

## Coordinates and dimensions

Lengths are in metres. Input angles are in degrees, converted to radians in code.
The book angle α runs from 0° (closed) to 180° (flat).

The origin O is where the folds meet. +x points toward the right page, +y follows
the horizontal spine, and +z points up. Gravity is (0, 0, −9.81) m/s². The pages
open symmetrically, with directions (±sin(α/2), 0, cos(α/2)). At 180° they lie
in the horizontal xy plane. Other book orientations are not implemented.

The geometry settings are attachment length a, ridge length h, and crease angle
β, where 0° < β < 90°. These are separate from material settings.

## Panel geometry

The four landmarks are:

    O = spine_origin = (0, 0, 0)
    L/R = left/right_wing_tip
        = (±a sin(β) sin(α/2), a cos(β), a sin(β) cos(α/2))
    C = ridge_tip = (0, h(1−k²)/(1+k²), 2hk/(1+k²))
    k = tan(β) cos(α/2)

L uses the negative x coordinate; R uses the positive one. The panels are
triangles O–L–C and O–C–R. O–L and O–R attach to the pages; O–C is the shared ridge.
The panel lengths stay fixed: |OL| = |OR| = a and |OC| = h, with included angle β.

The ridge equation comes from C·L = ah cos(β), |C| = h, and Cx = 0. We choose the
raised solution. Another solution, C = (0,h,0), exists; ideal hinges alone do not
choose between them. The raised solution becomes flat at 180°.

L and R follow the fixed page attachments, so C is a more useful landmark for
studying panel deformation. The flexible model also measures interior points.

## Limits and checks

The panels have zero thickness. They overlap at 0° and lie on the pages at 180°;
these endpoints do not account for contact. The model also leaves out friction,
crease resistance, page bending, glue flexibility, and construction errors.
It covers this symmetric triangular V-fold, not every pop-up geometry.

The tests check fixed edge lengths, page attachments, the flat-open case, and
invalid inputs. These check the geometry, not agreement with real paper.
The rigid solver rejects material parameters because it does not use them.
