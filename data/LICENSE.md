# Data license

The files in this folder (`graph.bin.gz`, `neurons.bin.gz`, `meta.json`, `pilot.json`) are
derived from the FlyWire whole-brain connectome, public release v783, and are licensed under
**Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)**:
https://creativecommons.org/licenses/by-nc/4.0/

You may share and adapt them for **non-commercial** purposes, with attribution. The MIT license
at the root of this repository does not apply to these files.

## Sources

- **FlyWire connectome v783**, © the FlyWire Consortium, released under CC BY-NC 4.0
  (https://flywire.ai/guidelines).
  - Dorkenwald, S. et al. Neuronal wiring diagram of an adult brain. *Nature* 634, 124–138 (2024).
    https://doi.org/10.1038/s41586-024-07558-y
  - Schlegel, P. et al. Whole-brain annotation and multi-connectome cell typing of *Drosophila*.
    *Nature* 634, 139–152 (2024). https://doi.org/10.1038/s41586-024-07686-5
- **Connectivity table** (`Connectivity_783.parquet`, `Completeness_783.csv`) from
  Shiu, P. K. et al. A *Drosophila* computational brain model reveals sensorimotor processing.
  *Nature* 634, 210–219 (2024). https://github.com/philshiu/Drosophila_brain_model
- **Neuron annotations** (`Supplemental_file1_neuron_annotations.tsv`) from
  https://github.com/flyconnectome/flywire_annotations (Schlegel et al. 2024).

## Changes made

These files are **modified** from the originals. `tools/prep_data.py` converts the connectivity
table into a compact binary graph, keeps only the fields the simulator needs (neuron positions,
cell type, super class, side, neurotransmitter), and adds `pilot.json`, a hand-made selection of
sensory, descending and motor neuron groups used by the rover.

These changes are not endorsed by the FlyWire Consortium or the authors above.
