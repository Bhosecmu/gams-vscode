"""
readgdx.py — Read a GDX file and output symbol data as JSON.

Usage:
  python readgdx.py <file.gdx>                   # output symbol index
  python readgdx.py <file.gdx> --interactive      # stdin/stdout mode for symbol data

Requires: gams-transfer  (pip install gams-transfer)
          Either GAMS installed (gams in PATH) or gamspy_base package.
"""
import sys
import json
import math
import os
import numpy as np

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


def sanitize(value):
    """Map GAMS special values to their display labels.

    gams.transfer returns these as specific float magnitudes:
      1e300  = UNDEF   (undefined)
      2e300  = NA      (not available)
      3e300  = +Inf    (plus infinity)
      4e300  = -Inf    (minus infinity)
      5e300  = Eps     (epsilon / essentially zero)
    """
    # gams.transfer may return numpy.float64, not Python float — check both.
    # Only called on paginated slices (≤500 rows) so per-cell cost is negligible.
    if isinstance(value, (float, np.floating)):
        fv = float(value)
        if fv == 1e300:    return "Undef"
        if fv == 2e300:    return "NA"
        if fv == 3e300:    return "Inf"
        if fv == 4e300:    return "-Inf"
        if fv == 5e300:    return "Eps"
        if math.isnan(fv): return "NA"
        if math.isinf(fv): return "Inf" if fv > 0 else "-Inf"
    return value


def sanitize_record(rec: dict) -> dict:
    return {k: sanitize(v) for k, v in rec.items()}


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

    def index(self) -> dict:
        """Return a dict mapping category → list of symbol names + descriptions."""
        categories: dict[str, list[dict]] = {
            "Sets": [],
            "Parameters": [],
            "Variables": [],
            "Equations": [],
            "Aliases": [],
        }
        import gams.transfer as gt  # type: ignore
        for name, sym in self.container.data.items():
            entry = {"name": name, "description": getattr(sym, "description", "") or ""}
            if isinstance(sym, gt.Set):
                if isinstance(sym, gt.Alias):
                    categories["Aliases"].append(entry)
                else:
                    categories["Sets"].append(entry)
            elif isinstance(sym, gt.Parameter):
                categories["Parameters"].append(entry)
            elif isinstance(sym, gt.Variable):
                categories["Variables"].append(entry)
            elif isinstance(sym, gt.Equation):
                categories["Equations"].append(entry)
        return categories

    def symbol_data(self, name: str, page: int, rows: int) -> dict:
        """Return paginated records for a symbol."""
        sym = self.container[name]
        description = getattr(sym, "description", "") or ""
        try:
            df = sym.records
        except Exception:
            df = None

        if df is None or (hasattr(df, "__len__") and len(df) == 0):
            return {"name": name, "description": description,
                    "columns": [], "records": [], "total": 0, "page": page, "rows": rows}

        total = len(df)
        start = (page - 1) * rows
        end = min(start + rows, total)
        slice_df = df.iloc[start:end]

        columns = list(df.columns)
        records = [sanitize_record(r) for r in slice_df.to_dict(orient="records")]

        return {
            "name": name,
            "description": description,
            "columns": columns,
            "records": records,
            "total": total,
            "page": page,
            "rows": rows,
        }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: readgdx.py <file.gdx> [--interactive]"}))
        sys.exit(1)

    gdx_path = sys.argv[1]
    interactive = "--interactive" in sys.argv

    try:
        reader = GdxReader(gdx_path)
    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)
        sys.exit(1)

    if not interactive:
        print(json.dumps(reader.index()), flush=True)
        return

    # Interactive mode: read JSON requests from stdin, write JSON responses to stdout
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            name = req["symbolName"]
            page = int(req.get("page", 1))
            rows = int(req.get("rows", 100))
            result = reader.symbol_data(name, page, rows)
            print(json.dumps(result), flush=True)
        except Exception as e:
            print(json.dumps({"error": str(e)}), flush=True)


if __name__ == "__main__":
    main()
