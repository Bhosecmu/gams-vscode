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


def sanitize_dataframe(df, gt):
    """Replace GAMS special float values with their string labels.

    gams.transfer actual Python mappings (from gt.SpecialValues):
      POSINF  →  float("inf")     detected by gt.SpecialValues.isPosInf
      NEGINF  →  float("-inf")    detected by gt.SpecialValues.isNegInf
      EPS     →  -0.0             detected by gt.SpecialValues.isEps
      NA      →  special NaN      detected by gt.SpecialValues.isNA
      UNDEF   →  float("nan")     detected by gt.SpecialValues.isUndef

    Applied vectorially on the already-paginated slice so there is no
    per-cell Python overhead regardless of the full GDX size.
    """
    import numpy as np

    df = df.copy()
    float_cols = df.select_dtypes(include=["float"]).columns

    for col in float_cols:
        arr = df[col].to_numpy()
        result = arr.astype(object)   # object array accepts mixed str/float

        # NA must come before isUndef: both are NaN bit patterns but
        # NA uses a distinct payload that only isNA detects correctly.
        result[gt.SpecialValues.isNA(arr)]     = "NA"
        result[gt.SpecialValues.isUndef(arr)]  = "Undef"
        result[gt.SpecialValues.isPosInf(arr)] = "Inf"
        result[gt.SpecialValues.isNegInf(arr)] = "-Inf"
        result[gt.SpecialValues.isEps(arr)]    = "Eps"

        df[col] = result

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
            if isinstance(sym, gt.Alias):
                categories["Aliases"].append(entry)
            elif isinstance(sym, gt.Set):
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
        gt  = self.gt
        sym = self.container[name]
        description = getattr(sym, "description", "") or ""

        try:
            df = sym.records
        except Exception:
            df = None

        if df is None or len(df) == 0:
            return {"name": name, "description": description,
                    "columns": [], "records": [], "total": 0, "page": page, "rows": rows}

        total   = len(df)
        start   = (page - 1) * rows
        end     = min(start + rows, total)
        slice_df = sanitize_dataframe(df.iloc[start:end], gt)

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
        print(json.dumps({"error": "Usage: readgdx.py <file.gdx> [--interactive]"}))
        sys.exit(1)

    gdx_path    = sys.argv[1]
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
            req  = json.loads(line)
            name = req["symbolName"]
            page = int(req.get("page", 1))
            rows = int(req.get("rows", 100))
            result = reader.symbol_data(name, page, rows)
            print(json.dumps(result), flush=True)
        except Exception as e:
            print(json.dumps({"error": str(e)}), flush=True)


if __name__ == "__main__":
    main()
