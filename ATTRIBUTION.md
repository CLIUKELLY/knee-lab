# Model attribution

`public/models/knee.glb` is adapted from **3D Reference Organ for Knee, Male, Left**, Human Reference Atlas / HuBMAP Consortium.

- Source: https://3d.nih.gov/entries/3DPX-021003
- Direct reference library: https://humanatlas.io/3d-reference-library
- License: Creative Commons Attribution 4.0 International (CC BY 4.0)
- Changes: materials, presentation, visibility, transforms, and interactive behavior are applied at runtime. The source geometry is otherwise unchanged.

## Educational soft-tissue reconstruction

The ACL, PCL, MCL, LCL, quadriceps tendon, patellar tendon, quadriceps, hamstrings and gastrocnemius are original procedural meshes generated at runtime for KNEE LAB. Their placement uses the source model's joint landmarks and standard anatomical relationships.

These meshes are intentionally simplified for orientation and interaction. They are not segmented patient data, are not suitable for measurement, diagnosis or surgical planning, and are released with the application code under the MIT License.

The educational descriptions in this project are general anatomical explanations and are not medical advice.

## Bilateral movement view

Both legs reuse the same Human Reference Atlas left-knee geometry and the same
procedural soft-tissue reconstruction, palette, and materials as the knee-detail
view. One instance is mirrored for the contralateral presentation; it is not an
independently segmented right knee. The shared anatomy is positioned in a
schematic hip–knee–ankle movement frame. The pelvic ring and segmented foot bones
are original procedural illustrations, not MRI/CT-derived anatomical meshes.
The 2D fallback is an original anatomical illustration with selectable tissue
layers, not a rendering or tracing of the source segmentation.
