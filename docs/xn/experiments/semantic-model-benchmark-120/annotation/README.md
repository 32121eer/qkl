# Independent double-annotation protocol

1. Give `annotator_a_blind.csv` and `annotator_b_blind.csv` to two people separately.
2. Each annotator fills every `label` with exactly `ACCEPT` or `REJECT`; do not share `admin_crosswalk.csv`.
3. Run `evaluate_annotations.js` only after both files are complete. It reports agreement and Cohen's kappa and creates a blind disagreement sheet.
4. A third reviewer fills the disagreement sheet without seeing `oracle_label`; rerun the evaluator with `ADJUDICATION_FILE`.

The deterministic oracle is used for benchmark scoring, not as a substitute for human labels.