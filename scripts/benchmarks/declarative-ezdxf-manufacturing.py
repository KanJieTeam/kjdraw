"""Trusted compact manufacturing-sheet intent -> editable ezdxf R2018 drawing.

The model provides only bounded design parameters. This module independently
computes views, feature arrays, layers, dimensions and notes; it never executes
model-authored code or opens model-selected paths.
"""
import io
import json
import math
import pathlib
import sys

SCHEMA = "com.kanjie.kjdraw.benchmark.declarative-ezdxf-manufacturing@1"
SHEETS = {(420, 297), (594, 420), (841, 594), (1189, 841)}
MAX_INPUT_BYTES = 131_072
MAX_DXF_BYTES = 4_194_304


def pairs_without_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def exact(value, fields):
    if not isinstance(value, dict) or set(value) != set(fields):
        raise ValueError("INVALID_SCHEMA")
    return value


def numeric(value, minimum, maximum):
    if type(value) not in (int, float) or not math.isfinite(value) or not minimum <= value <= maximum:
        raise ValueError("INVALID_NUMBER")
    return float(value)


def integer(value, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError("INVALID_INTEGER")
    return value


def vector(value, minimum=0, maximum=2000):
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError("INVALID_POINT")
    return [numeric(item, minimum, maximum) for item in value]


def label(value, maximum=96):
    if not isinstance(value, str) or not 1 <= len(value) <= maximum or any(ord(char) < 32 or ord(char) > 126 for char in value):
        raise ValueError("INVALID_LABEL")
    return value


def contract(content):
    data = json.loads(content, object_pairs_hook=pairs_without_duplicates)
    exact(data, ("schema", "units", "drawingId", "title", "revision", "material", "quantity",
                 "length", "width", "thickness", "holePatterns", "slots", "sheet", "textHeight"))
    if data["schema"] != SCHEMA or data["units"] != "millimeter":
        raise ValueError("UNSUPPORTED_SCHEMA_OR_UNITS")
    for name in ("drawingId", "title", "revision", "material"):
        label(data[name])
    integer(data["quantity"], 1, 100)
    length, width, thickness = (numeric(data[name], 1, 1500) for name in ("length", "width", "thickness"))
    if thickness >= min(length, width):
        raise ValueError("INVALID_PLATE")
    text_height = numeric(data["textHeight"], 2, 8)
    exact(data["sheet"], ("origin", "size"))
    if vector(data["sheet"]["origin"]) != [0, 0] or tuple(vector(data["sheet"]["size"])) not in SHEETS:
        raise ValueError("UNSUPPORTED_SHEET")
    patterns = data["holePatterns"]
    if not isinstance(patterns, list) or len(patterns) != 2:
        raise ValueError("HOLE_PATTERN_COUNT")
    for index, pattern in enumerate(patterns):
        fields = ("rows", "columns", "origin", "spacing", "throughDiameter") if index == 0 else (
            "rows", "columns", "origin", "spacing", "throughDiameter", "counterboreDiameter", "counterboreDepth")
        exact(pattern, fields)
        rows, columns = integer(pattern["rows"], 2, 12), integer(pattern["columns"], 2, 16)
        if rows * columns > 160:
            raise ValueError("HOLE_BUDGET")
        origin, spacing = vector(pattern["origin"]), vector(pattern["spacing"], 0.01, 1500)
        diameter = numeric(pattern["throughDiameter"], 0.1, 100)
        if index == 1:
            counterbore = numeric(pattern["counterboreDiameter"], diameter + 0.001, 120)
            depth = numeric(pattern["counterboreDepth"], 0.001, thickness - 0.001)
            if counterbore <= diameter or depth >= thickness:
                raise ValueError("INVALID_COUNTERBORE")
        if origin[0] - diameter / 2 <= 0 or origin[1] - diameter / 2 <= 0 or origin[0] + (columns - 1) * spacing[0] + diameter / 2 >= length or origin[1] + (rows - 1) * spacing[1] + diameter / 2 >= width:
            raise ValueError("HOLE_OUTSIDE_PLATE")
    slots = data["slots"]
    if not isinstance(slots, list) or len(slots) != 2:
        raise ValueError("SLOT_COUNT")
    for slot in slots:
        exact(slot, ("center", "length", "width", "orientationDegrees"))
        center = vector(slot["center"])
        slot_length = numeric(slot["length"], 1, 200)
        slot_width = numeric(slot["width"], 0.1, slot_length - 0.001)
        if type(slot["orientationDegrees"]) is not int or slot["orientationDegrees"] not in (0, 90):
            raise ValueError("SLOT_ORIENTATION")
        half_x, half_y = (slot_length / 2, slot_width / 2) if slot["orientationDegrees"] == 0 else (slot_width / 2, slot_length / 2)
        if center[0] - half_x <= 0 or center[0] + half_x >= length or center[1] - half_y <= 0 or center[1] + half_y >= width:
            raise ValueError("SLOT_OUTSIDE_PLATE")
    margin, title_height = max(8, text_height * 2), max(36, text_height * 9)
    dimension_pad, gap = max(10, text_height * 4), max(12, text_height * 5)
    sheet_width, sheet_height = data["sheet"]["size"]
    view_width = sheet_width - margin * 2 - dimension_pad
    view_height = sheet_height - margin * 2 - title_height - gap - dimension_pad * 1.5
    if min(view_width / length, view_height / (width + thickness)) < 1 - 1e-12:
        raise ValueError("SHEET_NOT_1_TO_1")
    return data, (margin, title_height, dimension_pad, gap, view_width)


def fmt(value):
    return str(int(value)) if float(value).is_integer() else f"{value:.3f}".rstrip("0").rstrip(".")


def notes_for(data):
    notes = [data["title"], f"DRAWING: {data['drawingId']}",
             f"MATERIAL: {data['material']} QTY: {data['quantity']}", f"REV: {data['revision']}",
             "UNITS: mm SCALE: 1:1"]
    for pattern in data["holePatterns"]:
        count = pattern["rows"] * pattern["columns"]
        if "counterboreDiameter" in pattern:
            notes.append(f"{count}X DIA {fmt(pattern['throughDiameter'])} THRU / C'BORE DIA {fmt(pattern['counterboreDiameter'])} DEPTH {fmt(pattern['counterboreDepth'])}")
        else:
            notes.append(f"{count}X DIA {fmt(pattern['throughDiameter'])} THRU")
        notes.extend((f"{pattern['columns'] - 1} SPACES @ {fmt(pattern['spacing'][0])}",
                      f"{pattern['rows'] - 1} SPACES @ {fmt(pattern['spacing'][1])}"))
    for index, slot in enumerate(data["slots"]):
        notes.append(f"S{index + 1} SLOT {fmt(slot['length'])} X {fmt(slot['width'])}")
    notes.extend(("MACHINING NOTES:", "1. ALL DIMENSIONS ARE IN MILLIMETERS.",
                  "2. REMOVE BURRS AND BREAK SHARP EDGES.",
                  "3. DO NOT SCALE DRAWING; USE NATIVE DIMENSIONS.", "TOP VIEW", "FRONT VIEW"))
    return notes


def build(data, layout):
    import ezdxf
    doc = ezdxf.new("R2018")
    doc.units = 4
    doc.header["$LTSCALE"] = 1
    doc.linetypes.add("MFG_HIDDEN", pattern=[4, 3, -1])
    doc.linetypes.add("MFG_CENTER", pattern=[11, 8, -1, 1, -1])
    for name, linetype, weight in (
        ("OUTLINE", "CONTINUOUS", 35), ("HIDDEN", "MFG_HIDDEN", 18),
        ("CENTER", "MFG_CENTER", 18), ("DIMENSIONS", "CONTINUOUS", 18),
        ("NOTES", "CONTINUOUS", 18), ("SHEET", "CONTINUOUS", 25)):
        doc.layers.new(name, dxfattribs={"linetype": linetype, "lineweight": weight})
    model = doc.modelspace()
    length, width, thickness = (data[name] for name in ("length", "width", "thickness"))
    text_height = data["textHeight"]
    margin, title_height, pad, gap, view_width = layout
    front_x = margin + pad + (view_width - length) / 2
    front_y = margin + title_height + text_height * 2
    top_x, top_y = front_x, front_y + thickness + gap

    def line(x1, y1, x2, y2, layer):
        model.add_line((x1, y1), (x2, y2), dxfattribs={"layer": layer})

    def circle(x, y, radius):
        model.add_circle((x, y), radius, dxfattribs={"layer": "OUTLINE"})

    def arc(x, y, radius, start, end):
        model.add_arc((x, y), radius, start, end, dxfattribs={"layer": "OUTLINE"})

    def rectangle(x, y, w, h, layer):
        line(x, y, x + w, y, layer)
        line(x + w, y, x + w, y + h, layer)
        line(x + w, y + h, x, y + h, layer)
        line(x, y + h, x, y, layer)

    sheet_width, sheet_height = data["sheet"]["size"]
    rectangle(0, 0, sheet_width, sheet_height, "SHEET")
    rectangle(top_x, top_y, length, width, "OUTLINE")
    rectangle(front_x, front_y, length, thickness, "OUTLINE")
    line(top_x - text_height, top_y + width / 2, top_x + length + text_height, top_y + width / 2, "CENTER")
    line(top_x + length / 2, top_y - text_height, top_x + length / 2, top_y + width + text_height, "CENTER")
    line(front_x - text_height, front_y + thickness / 2, front_x + length + text_height, front_y + thickness / 2, "CENTER")

    for pattern in data["holePatterns"]:
        projected_columns = set()
        diameter = pattern["throughDiameter"]
        center_size = max(text_height, diameter * 0.75)
        for row in range(pattern["rows"]):
            for column in range(pattern["columns"]):
                plate_x = pattern["origin"][0] + column * pattern["spacing"][0]
                plate_y = pattern["origin"][1] + row * pattern["spacing"][1]
                x, y = top_x + plate_x, top_y + plate_y
                circle(x, y, diameter / 2)
                if "counterboreDiameter" in pattern:
                    circle(x, y, pattern["counterboreDiameter"] / 2)
                line(x - center_size, y, x + center_size, y, "CENTER")
                line(x, y - center_size, x, y + center_size, "CENTER")
                if plate_x in projected_columns:
                    continue
                projected_columns.add(plate_x)
                projected_x, radius = front_x + plate_x, diameter / 2
                depth = pattern.get("counterboreDepth", 0)
                line(projected_x - radius, front_y, projected_x - radius, front_y + thickness - depth, "HIDDEN")
                line(projected_x + radius, front_y, projected_x + radius, front_y + thickness - depth, "HIDDEN")
                line(projected_x, front_y - text_height, projected_x, front_y + thickness + text_height, "CENTER")
                if "counterboreDiameter" in pattern:
                    cb_radius, bottom = pattern["counterboreDiameter"] / 2, front_y + thickness - depth
                    line(projected_x - cb_radius, bottom, projected_x - cb_radius, front_y + thickness, "HIDDEN")
                    line(projected_x + cb_radius, bottom, projected_x + cb_radius, front_y + thickness, "HIDDEN")
                    line(projected_x - cb_radius, bottom, projected_x - radius, bottom, "HIDDEN")
                    line(projected_x + radius, bottom, projected_x + cb_radius, bottom, "HIDDEN")

    for slot in data["slots"]:
        cx, cy = top_x + slot["center"][0], top_y + slot["center"][1]
        radius = slot["width"] / 2
        half_straight = (slot["length"] - slot["width"]) / 2
        half_length = slot["length"] / 2
        if slot["orientationDegrees"] == 0:
            line(cx - half_straight, cy + radius, cx + half_straight, cy + radius, "OUTLINE")
            line(cx + half_straight, cy - radius, cx - half_straight, cy - radius, "OUTLINE")
            arc(cx + half_straight, cy, radius, 270, 90)
            arc(cx - half_straight, cy, radius, 90, 270)
            line(cx - half_length - text_height, cy, cx + half_length + text_height, cy, "CENTER")
            line(cx, cy - radius - text_height, cx, cy + radius + text_height, "CENTER")
            projected_half_width = half_length
        else:
            line(cx - radius, cy - half_straight, cx - radius, cy + half_straight, "OUTLINE")
            line(cx + radius, cy + half_straight, cx + radius, cy - half_straight, "OUTLINE")
            arc(cx, cy + half_straight, radius, 0, 180)
            arc(cx, cy - half_straight, radius, 180, 0)
            line(cx, cy - half_length - text_height, cx, cy + half_length + text_height, "CENTER")
            line(cx - radius - text_height, cy, cx + radius + text_height, cy, "CENTER")
            projected_half_width = radius
        projected_x = front_x + slot["center"][0]
        line(projected_x - projected_half_width, front_y, projected_x - projected_half_width, front_y + thickness, "HIDDEN")
        line(projected_x + projected_half_width, front_y, projected_x + projected_half_width, front_y + thickness, "HIDDEN")

    title_x, title_y, title_width = 8, 8, sheet_width - 16
    rectangle(title_x, title_y, title_width, 36, "SHEET")
    title_split = title_x + title_width * 0.62
    line(title_split, title_y, title_split, title_y + 36, "SHEET")
    line(title_split, title_y + 18, title_x + title_width, title_y + 18, "SHEET")
    notes = notes_for(data)
    rows_per_column = math.ceil(len(notes) / 3)
    for index, note in enumerate(notes):
        column, row = divmod(index, rows_per_column)
        x = title_x + 4 + column * title_width / 3
        y = title_y + 3 + row * (title_height - 6) / max(1, rows_per_column - 1)
        model.add_text(note, dxfattribs={"insert": (x, y), "height": text_height, "layer": "NOTES"})

    override = {"dimtxt": text_height, "dimlfac": 1, "dimscale": 1}
    def aligned(p1, p2, placement):
        vx, vy = p2[0] - p1[0], p2[1] - p1[1]
        distance = (vx * (placement[1] - p1[1]) - vy * (placement[0] - p1[0])) / math.hypot(vx, vy)
        dim = model.add_aligned_dim(p1, p2, distance=distance, override=override, dxfattribs={"layer": "DIMENSIONS"})
        dim.render()
        entity = dim.dimension
        entity.dxf.dimtype = (entity.dxf.dimtype & ~7) | 1
        entity.dxf.defpoint = (*placement, 0)

    def diameter(cx, cy, radius, placement):
        dim = model.add_diameter_dim(center=(cx, cy), radius=radius, location=placement,
                                     override=override, dxfattribs={"layer": "DIMENSIONS"})
        dim.render()
        entity = dim.dimension
        entity.dxf.defpoint = (cx - radius, cy, 0)
        entity.dxf.defpoint4 = (cx + radius, cy, 0)
        entity.dxf.text_midpoint = (*placement, 0)

    aligned((top_x, top_y), (top_x + length, top_y), (top_x + length / 2, top_y - pad / 2))
    aligned((top_x, top_y), (top_x, top_y + width), (top_x - pad / 2, top_y + width / 2))
    aligned((front_x, front_y), (front_x, front_y + thickness), (front_x - pad / 2, front_y + thickness / 2))
    for index, pattern in enumerate(data["holePatterns"]):
        cx, cy = top_x + pattern["origin"][0], top_y + pattern["origin"][1]
        lane = index + 1
        diameter_x = cx if index == 0 else cx + (pattern["columns"] - 1) * pattern["spacing"][0]
        diameter_y = cy if index == 0 else cy + (pattern["rows"] - 1) * pattern["spacing"][1]
        diameter(diameter_x, diameter_y, pattern["throughDiameter"] / 2,
                 (diameter_x + pad * 2, diameter_y + pad * (1 if index == 0 else -1)))
        aligned((cx, cy), (cx + pattern["spacing"][0], cy),
                (cx + pattern["spacing"][0] / 2, top_y - lane * pad / 2))
        aligned((cx, cy), (cx, cy + pattern["spacing"][1]),
                (top_x - lane * pad / 2, cy + pattern["spacing"][1] / 2))
    for slot in data["slots"]:
        cx, cy = top_x + slot["center"][0], top_y + slot["center"][1]
        half, radius = slot["length"] / 2, slot["width"] / 2
        if slot["orientationDegrees"] == 0:
            aligned((cx - half, cy), (cx + half, cy), (cx, cy + radius + pad / 2))
        else:
            aligned((cx, cy - half), (cx, cy + half), (cx + radius + pad / 2, cy))
    for block in doc.blocks:
        if block.name.startswith("*D"):
            for insert in list(block.query("INSERT")):
                insert.explode(target_layout=block)
    if "_CLOSEDFILLED" in doc.blocks:
        doc.blocks.delete_block("_CLOSEDFILLED", safe=False)
    audit = doc.audit()
    if audit.errors or audit.fixes:
        raise ValueError("DXF_AUDIT_FAILED")
    stream = io.StringIO(newline="")
    doc.write(stream)
    dxf = stream.getvalue()
    if len(dxf.encode("utf-8")) > MAX_DXF_BYTES:
        raise ValueError("DXF_BUDGET")
    return {"passed": True, "schema": SCHEMA, "units": "millimeter", "dxf": dxf,
            "entities": len(model), "ezdxfVersion": ezdxf.__version__}


def main():
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        raise ValueError("INPUT_BUDGET")
    envelope = json.loads(raw, object_pairs_hook=pairs_without_duplicates)
    exact(envelope, ("content", "ezdxfPath"))
    content = envelope["content"]
    if not isinstance(content, str) or len(content.encode("utf-8")) > MAX_INPUT_BYTES:
        raise ValueError("MODEL_JSON_BUDGET")
    path = envelope["ezdxfPath"]
    if path is not None:
        if not isinstance(path, str) or not pathlib.Path(path).is_absolute() or not pathlib.Path(path).is_dir():
            raise ValueError("INVALID_RUNTIME_PATH")
        sys.path.append(path)
    data, layout = contract(content)
    print(json.dumps(build(data, layout), ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        known = {
            "DUPLICATE_JSON_KEY", "INVALID_SCHEMA", "INVALID_NUMBER", "INVALID_INTEGER",
            "INVALID_POINT", "INVALID_LABEL", "UNSUPPORTED_SCHEMA_OR_UNITS", "INVALID_PLATE",
            "UNSUPPORTED_SHEET", "HOLE_PATTERN_COUNT", "HOLE_BUDGET", "INVALID_COUNTERBORE",
            "HOLE_OUTSIDE_PLATE", "SLOT_COUNT", "SLOT_ORIENTATION", "SLOT_OUTSIDE_PLATE",
            "SHEET_NOT_1_TO_1", "DXF_AUDIT_FAILED", "DXF_BUDGET", "INPUT_BUDGET",
            "MODEL_JSON_BUDGET", "INVALID_RUNTIME_PATH",
        }
        reason = str(error) if isinstance(error, ValueError) and str(error) in known else type(error).__name__
        print(json.dumps({"passed": False, "reason": reason}))
        sys.exit(1)
