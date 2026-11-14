"""Errors shared by the companion modules."""


class SetupError(RuntimeError):
    """Something the user must fix: a missing file or program, or a broken config.json."""
