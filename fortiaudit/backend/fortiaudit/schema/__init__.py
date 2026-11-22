"""Version-aware schema registry. Add a module per firmware train and register it here."""
from . import fos74

_REGISTRY = {"7.4": fos74}


def for_version(version: str | None):
    """Return (schema_module, exact_match: bool) for a FortiOS version string like '7.4.12'."""
    if version:
        train = ".".join(version.split(".")[:2])
        if train in _REGISTRY:
            mod = _REGISTRY[train]
            return mod, version == mod.TARGET["version"]
    return fos74, False
