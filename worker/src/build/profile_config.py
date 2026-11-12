"""The settings of "profile from callout" (one place, easy to change).

TYP_SCOPE: which members a "TYP" / "TYPICAL" size label gives its profile to.
  "view_family"      the members of the same view and the same family group (column families for
                     columns, beam families for beams); the NEAREST TYP label wins; an exact tie
                     between different profiles leaves the member unset (default; the estimator is
                     still confirming this meaning).
  "glyph_signature"  the earlier Phase 12b rule: columns with the same symbol signature as a column
                     the TYP label is attached to (columns only).
The API reads the same value from the environment (PROFILE_TYP_SCOPE) so both sides agree.
"""

import os

TYP_SCOPE = os.environ.get("PROFILE_TYP_SCOPE", "view_family")
assert TYP_SCOPE in ("view_family", "glyph_signature")

COLUMN_LABEL_MAX_PT = 60.0  # nearest column label (unchanged from Phase 12b)
LEADER_LABEL_PT = 6.0  # a leader segment ends at the label box within this
LEADER_COLUMN_PT = 8.0  # and at the column within this
LEADER_MIN_PT = 6.0
LEADER_MAX_PER_LABEL = 4
TIE_PT = 0.5  # two TYP labels this close in distance are tied
HIGH_RIVAL_RATIO = 1.6  # nearest label: the next label of another profile is this much farther
MEDIUM_RIVAL_RATIO = 1.25
HIGH_DISTANCE_PT = 36.0
BEAM_FAMILIES_EXCLUDED = ("W", "HSS", "HP", "PIPE", "S", "M")  # = COLUMN_FAMILIES (labels.py)
