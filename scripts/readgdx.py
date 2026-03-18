"""
readgdx.py — Read a GDX file and output symbol data as JSON.

Requires: gams-transfer  (pip install gams-transfer)
          Either GAMS installed (gams in PATH) or gamspy_base package.
"""
import sys
import json
import os


def find_gams_sysdir() -> str | None:
    """Return the GAMS system directory, or None if not found."""
    import shutil
    gams_exe = shutil.which("gams")
    if gams_exe:
        return os.path.dirname(os.path.realpath(gams_exe))
    try:
        import gamspy_base  # type: ignore
        return gamspy_base.directory
    except ImportError:
        pass
    return None


class _NumpyEncoder(json.JSONEncoder):
    """Fallback encoder so numpy scalars don't crash json.dumps on NumPy >= 2.0."""
    def default(self, obj):
        try:
            import numpy as np
            if isinstance(obj, np.floating):
                return float(obj)
            if isinstance(obj, np.integer):
                return int(obj)
            if isinstance(obj, np.ndarray):
                return obj.tolist()
        except ImportError:
            pass
        return super().default(obj)


def _sanitize_value(v):
    """Convert a single value to something json.dumps(allow_nan=False) accepts."""
    import math, numpy as np
    if isinstance(v, float):
        if math.isnan(v):   return "NA"
        if math.isinf(v):   return "Inf" if v > 0 else "-Inf"
        return v
    if isinstance(v, np.floating):
        f = float(v)
        if math.isnan(f):   return "NA"
        if math.isinf(f):   return "Inf" if f > 0 else "-Inf"
        return f
    if isinstance(v, np.integer):
        return int(v)
    return v


def sanitize_dataframe(df):
    """Replace NaN/Inf/special-float with JSON-safe strings so that
    json.dumps(allow_nan=False) never raises on the result."""
    import numpy as np

    df = df.copy()

    for col in df.columns:
        kind = df[col].dtype.kind
        if kind == 'f':
            # Fast vectorised path for float columns
            arr = df[col].to_numpy()
            if np.isnan(arr).any() or np.isinf(arr).any():
                result = arr.astype(object)
                result[np.isposinf(arr)] = "Inf"
                result[np.isneginf(arr)] = "-Inf"
                result[np.isnan(arr)]    = "NA"
                df[col] = result
            else:
                df[col] = arr.tolist()
        elif kind == 'O':
            # Object columns may contain float NaN (gams.transfer mixed types)
            df[col] = [_sanitize_value(v) for v in df[col]]

    return df


class GdxReader:
    def __init__(self, gdx_path: str):
        sysdir = find_gams_sysdir()
        try:
            import gams.transfer as gt  # type: ignore
        except ImportError:
            raise ImportError(
                "Package 'gams-transfer' not found. "
                "Install it with:  pip install gams-transfer"
            )
        kwargs = {"system_directory": sysdir} if sysdir else {}
        self.container = gt.Container(gdx_path, **kwargs)
        self.gt = gt

    def index(self) -> dict:
        """Return a dict mapping category → list of symbol names + descriptions."""
        gt = self.gt
        categories: dict[str, list[dict]] = {
            "Sets": [],
            "Parameters": [],
            "Variables": [],
            "Equations": [],
            "Aliases": [],
        }
        for name, sym in self.container.data.items():
            entry = {"name": name, "description": getattr(sym, "description", "") or ""}
            # Check most-specific types first: Variable and Equation are subclasses
            # of Parameter in gams.transfer, so they must be tested before Parameter.
            if isinstance(sym, gt.Alias):
                categories["Aliases"].append(entry)
            elif isinstance(sym, gt.Set):
                categories["Sets"].append(entry)
            elif isinstance(sym, gt.Variable):
                categories["Variables"].append(entry)
            elif isinstance(sym, gt.Equation):
                categories["Equations"].append(entry)
            elif isinstance(sym, gt.Parameter):
                categories["Parameters"].append(entry)
        return categories

    def symbol_data(self, name: str, page: int, rows: int) -> dict:
        """Return paginated records for a symbol."""
        sym = self.container[name]
        description = getattr(sym, "description", "") or ""

        try:
            df = sym.records
        except Exception:
            df = None

        if df is None or len(df) == 0:
            return {"name": name, "description": description,
                    "columns": [], "records": [], "total": 0, "page": page, "rows": rows}

        total    = len(df)
        start    = (page - 1) * rows
        end      = min(start + rows, total)
        slice_df = sanitize_dataframe(df.iloc[start:end])

        return {
            "name":        name,
            "description": description,
            "columns":     list(df.columns),
            "records":     slice_df.to_dict(orient="records"),
            "total":       total,
            "page":        page,
            "rows":        rows,
        }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"command": "index", "error": "Usage: readgdx.py <file.gdx>"}))
        sys.exit(1)

    gdx_path = sys.argv[1]

    try:
        reader = GdxReader(gdx_path)
    except Exception as e:
        print(json.dumps({"command": "index", "error": str(e)}), flush=True)
        sys.exit(1)

    # Interactive mode: read JSON commands from stdin, write responses to stdout.
    # Supported commands:
    #   {"command": "index"}
    #   {"command": "symbolData", "symbolName": "...", "page": 1, "rows": 100}
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        name = None
        try:
            req  = json.loads(line)
            cmd  = req.get("command", "symbolData")

            if cmd == "index":
                data = reader.index()
                print(json.dumps({"command": "index", "data": data},
                                  cls=_NumpyEncoder, allow_nan=False), flush=True)
            else:
                name   = req["symbolName"]
                page   = int(req.get("page", 1))
                rows   = int(req.get("rows", 100))
                result = reader.symbol_data(name, page, rows)
                print(json.dumps(result, cls=_NumpyEncoder, allow_nan=False), flush=True)
        except Exception as e:
            try:
                print(json.dumps({"error": str(e), "name": name,
                                   "command": req.get("command", "symbolData") if 'req' in dir() else "symbolData"},
                                  allow_nan=False), flush=True)
            except Exception as e2:
                print(json.dumps({"error": repr(e2), "name": name, "command": "symbolData"}),
                      flush=True)


if __name__ == "__main__":
    main()
