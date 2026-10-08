"""Encoding quality of text extracted from a PDF text layer.

A text layer with broken font encodings (private-use code points, U+FFFD, unassigned or control
characters) is not trusted: the page falls back to the glyph reader instead of mixing sources.
The threshold is a tunable default, not a measured value.
"""

import unicodedata

GARBLED_BELOW = 0.90  # page text quality under this: the text layer is not used
MIN_TEXT_CHARS = 20  # fewer non-space characters than this: no real text layer

_BAD_CATEGORIES = frozenset({"Co", "Cn", "Cs", "Cc"})
_ALLOWED_CONTROLS = frozenset("\t\n\r")


def is_good_char(ch: str) -> bool:
    """Printable, assigned, not private-use, not the replacement character."""
    if ch == "�":
        return False
    if ch in _ALLOWED_CONTROLS:
        return True
    return unicodedata.category(ch) not in _BAD_CATEGORIES


def bad_char_count(text: str) -> int:
    return sum(1 for ch in text if not is_good_char(ch))


def text_quality(text: str) -> float | None:
    """Share of good characters among the non-space characters; None when there are none."""
    chars = [ch for ch in text if not ch.isspace()]
    if not chars:
        return None
    return round(1.0 - bad_char_count("".join(chars)) / len(chars), 4)


def is_usable(quality: float | None) -> bool:
    return quality is not None and quality >= GARBLED_BELOW
