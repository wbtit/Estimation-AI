"""Fixed rules for assembling and decoding text lines.

Every number here was defined BEFORE any scoring on ground truth (docs/PHASE4B_PLAN.md). The line
rules and cluster constants are those of Phase 4a. The word-space rule rests on the measured
distribution of 22,235 neighbouring-character gaps (95% below 0.38 x character height, a valley at
0.40 to 0.50). Do not tune these on the evaluation set.
"""

# --- stroke clusters (Phase 4a) -------------------------------------------------------------
MAX_STROKE_PT = 14.0  # a stroked path longer than this is not part of a character
CLUSTER_EPS_PT = 0.2  # bounding boxes closer than this belong to one character
DARK_MAX_MEAN_COLOUR = 0.5

# --- upright line assembly (Phase 4a) -------------------------------------------------------
CHAR_MIN_PT = 3.0  # a cluster with a dimension at least this large is character-like
CHAR_MAX_MIN_DIM_PT = 14.0  # ...and its smaller dimension is below this
LINE_CENTRE_TOL = 0.35  # vertical-centre difference, as a fraction of the larger height
LINE_GAP_MIN_PT = -0.6  # horizontal gap range between neighbouring characters
LINE_GAP_MAX_H = 1.0  # ...upper limit, as a fraction of the larger height
MIN_LINE_CHARS = 2

# --- small marks and layout (defined for Phase 4b) ------------------------------------------
DOT_MAX_PT = 1.5  # a cluster smaller than this in both dimensions is a dot
COLON_DX_PT = 1.0  # two dots within this in x ...
COLON_MIN_DY_PT = 1.5  # ... and at least this far apart in y form ':'
ATTACH_GAP_R = 0.6  # a small cluster belongs to a line within this x R horizontally ...
ATTACH_VERT_R = 0.3  # ... and within this x R of the line's vertical range
WORD_SPACE_R = 0.45  # a gap larger than this x R is a word space (R = median char height)
UNDERLINE_WIDTH_R = 1.2  # a '-' wider than this x R is an underline (a hyphen is about 0.7 x R)
EQUALS_EDGE_TOL_PT = 0.6  # two stacked '-' bars with edges within this form '='
EQUALS_MIN_DY_R = 0.15  # ... and vertical centres this far apart (x R) ...
EQUALS_MAX_DY_R = 0.6  # ... but not farther than this
LOWERCASE_BELOW_C = 0.8  # a letter shorter than this x C is lower case (C = cap/digit height)

# --- confidence (rule-based constants, not calibrated probabilities) -------------------------
CONF_GLYPH_ONLY = 0.8
CONF_GLYPH_UNKNOWN = 0.3
CONF_OCR_AGREES = 0.95
CONF_OCR_DISAGREES = 0.5

REASON_UNKNOWN_GLYPH = "unknown_glyph"
REASON_OCR_DISAGREES = "ocr_disagrees"
REASON_VERTICAL_NOT_READ = "vertical_text_not_read"
