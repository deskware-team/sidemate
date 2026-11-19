# -*- coding: utf-8 -*-
"""画流程图、组织分工图、时间线，输出 Word / PPT 里能改的方框和箭头。

用法：
    <随包 python> draw_diagram.py 图.json
图.json 里写图的内容和输出文件；命令行参数可以覆盖输出位置和格式。
只依赖随包的 python-pptx / python-docx / Pillow / lxml：不联网、不装东西、不开浏览器。
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path


def _load_copy():
    """回给模型的话在 app/copy/harness.mjs 的 diagram：按路径载进 app/copy/copy.py，不叫 copy。"""
    path = Path(__file__).resolve().parents[3] / "copy" / "copy.py"
    spec = importlib.util.spec_from_file_location("sidemate_copy", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


COPY = _load_copy()

# ---------------------------------------------------------------- 常量

FONT = COPY.t("diagramData.font")
PPT_PAGE = (720.0, 540.0)      # 幻灯片 10 x 7.5 英寸，单位 pt
DOCX_PAGE = (595.3, 841.9)     # A4，单位 pt
PPT_MARGIN = 30.0
DOCX_MARGIN = 56.7
NODE_FONT = 14.0
LABEL_FONT = 11.0
TITLE_FONT = 22.0
LINE_H = 1.35
BOX_PAD_X = 14.0
BOX_PAD_Y = 9.0
MIN_W = 96.0
MAX_W = 220.0
V_GAP = 30.0
H_GAP = 40.0
TITLE_SPACE = 44.0
INK = "22201C"
LINE_COLOR = "8A867C"
BOX_FILL = "FFFFFF"
BOX_LINE = "3B82F6"
SOFT_FILL = "FEF3C7"
SOFT_LINE = "F59E0B"
GRAY = "C9C4B8"
SHAPES = ("box", "diamond", "start", "end", "note")


class SpecError(Exception):
    """图谱写错了：报人话，不抛栈。"""


# ---------------------------------------------------------------- 文字量宽

def is_wide(ch: str) -> bool:
    """全角字（含中文和中文标点）按一个字宽算。"""
    code = ord(ch)
    return (0x1100 <= code <= 0x115F or 0x2E80 <= code <= 0xA4CF or 0xAC00 <= code <= 0xD7A3
            or 0xF900 <= code <= 0xFAFF or 0xFE30 <= code <= 0xFE4F
            or 0xFF00 <= code <= 0xFF60 or 0xFFE0 <= code <= 0xFFE6)


def char_width(ch: str, size: float) -> float:
    return size if is_wide(ch) else size * 0.55


def text_width(text: str, size: float) -> float:
    return sum(char_width(ch, size) for ch in text)


def wrap_text(text: str, size: float, max_w: float) -> list[str]:
    """按可用宽度把文字断成几行；字太长就一个字一行，不丢字。"""
    lines: list[str] = []
    for para in str(text).split("\n"):
        cur = ""
        cur_w = 0.0
        for ch in para:
            width = char_width(ch, size)
            if cur and cur_w + width > max_w:
                lines.append(cur)
                cur, cur_w = ch, width
            else:
                cur += ch
                cur_w += width
        lines.append(cur)
    return lines or [""]


# ---------------------------------------------------------------- 图谱解析

class Node:
    def __init__(self, nid, text, shape="box", parent=None):
        self.id = nid
        self.text = text
        self.shape = shape
        self.parent = parent
        self.level = 0
        self.x = self.y = self.w = self.h = 0.0
        self.lines = [text]

    @property
    def cx(self) -> float:
        return self.x + self.w / 2

    @property
    def cy(self) -> float:
        return self.y + self.h / 2

    @property
    def left(self) -> float:
        return self.x

    @property
    def right(self) -> float:
        return self.x + self.w

    @property
    def top(self) -> float:
        return self.y

    @property
    def bottom(self) -> float:
        return self.y + self.h


class Edge:
    def __init__(self, src, dst, label="", dashed=False):
        self.src = src
        self.dst = dst
        self.label = label
        self.dashed = dashed


class Spec:
    def __init__(self, kind, title, nodes, edges, out_format, out_file, mode="shapes"):
        self.kind = kind
        self.title = title
        self.nodes = nodes
        self.edges = edges
        self.out_format = out_format
        self.out_file = out_file
        self.mode = mode


def parse_spec(data) -> Spec:
    if not isinstance(data, dict):
        raise SpecError(COPY.t("diagram.notObject"))
    kind = str(data.get("type") or data.get("kind") or "flow").strip().lower()
    if kind not in ("flow", "org", "timeline"):
        raise SpecError(COPY.t("diagram.badType", kind=kind))
    title = data.get("title", "")
    if title is not None and not isinstance(title, str):
        raise SpecError(COPY.t("diagram.titleText"))
    raw_nodes = data.get("nodes")
    if not isinstance(raw_nodes, list) or not raw_nodes:
        raise SpecError(COPY.t("diagram.noNodes"))
    nodes: list[Node] = []
    seen: set[str] = set()
    for index, item in enumerate(raw_nodes):
        if isinstance(item, str):
            item = {"text": item}
        if not isinstance(item, dict):
            raise SpecError(COPY.t("diagram.nodeItem", index=index + 1))
        nid = str(item.get("id") or f"n{index + 1}")
        if nid in seen:
            raise SpecError(COPY.t("diagram.nodeRepeat", id=nid))
        seen.add(nid)
        text = item.get("text", "")
        if not isinstance(text, str) or text.strip() == "":
            raise SpecError(COPY.t("diagram.nodeEmpty", id=nid))
        shape = str(item.get("shape") or "box").strip().lower()
        if shape not in SHAPES:
            raise SpecError(COPY.t("diagram.nodeShape", id=nid, shapes="、".join(SHAPES), shape=shape))
        parent = item.get("parent")
        nodes.append(Node(nid, text, shape, str(parent) if parent not in (None, "") else None))
    by_id = {node.id: node for node in nodes}
    raw_edges = data.get("edges") or []
    if not isinstance(raw_edges, list):
        raise SpecError(COPY.t("diagram.edgesArray"))
    edges: list[Edge] = []
    for index, item in enumerate(raw_edges):
        if not isinstance(item, dict):
            raise SpecError(COPY.t("diagram.edgeItem", index=index + 1))
        src = str(item.get("from") or "")
        dst = str(item.get("to") or "")
        if src not in by_id:
            raise SpecError(COPY.t("diagram.edgeFrom", index=index + 1, id=src))
        if dst not in by_id:
            raise SpecError(COPY.t("diagram.edgeTo", index=index + 1, id=dst))
        label = item.get("label", "")
        if label is None:
            label = ""
        if not isinstance(label, str):
            raise SpecError(COPY.t("diagram.edgeLabel", index=index + 1))
        style = str(item.get("style") or "solid").strip().lower()
        if style not in ("solid", "dashed"):
            raise SpecError(COPY.t("diagram.edgeStyle", index=index + 1, style=style))
        edges.append(Edge(src, dst, label, style == "dashed"))
    out = data.get("output") or {}
    if not isinstance(out, dict):
        raise SpecError(COPY.t("diagram.outputObject"))
    out_format = str(out.get("format") or "pptx").strip().lower()
    if out_format not in ("pptx", "docx"):
        raise SpecError(COPY.t("diagram.outputFormat", format=out_format))
    out_file = out.get("file") or ""
    if not isinstance(out_file, str):
        raise SpecError(COPY.t("diagram.outputFile"))
    mode = str(out.get("mode") or "shapes").strip().lower()
    if mode not in ("shapes", "png"):
        raise SpecError(COPY.t("diagram.outputMode", mode=mode))
    for node in nodes:
        if node.parent and node.parent not in by_id:
            raise SpecError(COPY.t("diagram.parentMissing", id=node.id, parent=node.parent))
    return Spec(kind, str(title or ""), nodes, edges, out_format, out_file, mode)


# ---------------------------------------------------------------- 元素

def box_element(node: Node) -> dict:
    if node.shape == "diamond":
        shape = "diamond"
    elif node.shape == "ellipse":
        shape = "ellipse"
    else:
        shape = "roundRect"
    if node.shape in ("note", "start", "end"):
        fill, line = SOFT_FILL, SOFT_LINE
    else:
        fill, line = BOX_FILL, BOX_LINE
    return {"kind": "box", "shape": shape, "x": node.x, "y": node.y, "w": node.w, "h": node.h,
            "lines": list(node.lines), "fill": fill, "line": line, "font": NODE_FONT,
            "bold": node.shape in ("start", "end")}


def text_element(x, y, w, h, text, font, color=INK, bold=False) -> dict:
    return {"kind": "text", "x": x, "y": y, "w": w, "h": h, "lines": wrap_text(text, font, w),
            "font": font, "color": color, "bold": bold, "align": "center"}


def line_element(x1, y1, x2, y2, dashed=False, arrow=True, color=LINE_COLOR, width=1.5) -> dict:
    return {"kind": "line", "x1": x1, "y1": y1, "x2": x2, "y2": y2, "dashed": dashed,
            "arrow": arrow, "color": color, "width": width}


def measure_node(node: Node) -> None:
    """按文字算框的大小：字越长框越宽，超过上限就换行，框跟着变高。"""
    lines = wrap_text(node.text, NODE_FONT, MAX_W - 2 * BOX_PAD_X)
    width = max(text_width(line, NODE_FONT) for line in lines) + 2 * BOX_PAD_X
    node.lines = lines
    node.w = max(MIN_W, min(MAX_W, width))
    node.h = len(lines) * NODE_FONT * LINE_H + 2 * BOX_PAD_Y
    if node.shape == "diamond":
        node.w = min(MAX_W + 30.0, node.w + 46.0)
        node.h += 26.0


def compute_levels(nodes: list[Node], edges: list[Edge]) -> None:
    """层号：没有入边的节点是第 0 层，其余看最长来路。"""
    incoming: dict[str, list[str]] = {node.id: [] for node in nodes}
    for edge in edges:
        incoming[edge.dst].append(edge.src)
    level = {node.id: 0 for node in nodes}
    for _ in range(len(nodes) + 1):
        changed = False
        for node in nodes:
            if incoming[node.id]:
                want = max(level[src] for src in incoming[node.id]) + 1
                if want > level[node.id]:
                    level[node.id] = want
                    changed = True
        if not changed:
            break
    for node in nodes:
        node.level = level[node.id]


# ---------------------------------------------------------------- 排版

def layout_flow(spec: Spec, canvas_w: float, canvas_h: float) -> list[dict]:
    nodes = spec.nodes
    by_id = {node.id: node for node in nodes}
    for node in nodes:
        measure_node(node)
    compute_levels(nodes, spec.edges)
    groups: dict[int, list[Node]] = {}
    for node in nodes:
        groups.setdefault(node.level, []).append(node)
    y = TITLE_SPACE
    for level in sorted(groups):
        band = max(node.h for node in groups[level])
        for node in groups[level]:
            node.y = y + (band - node.h) / 2
        y += band + V_GAP
    for level in sorted(groups):
        row = groups[level]
        total = sum(node.w for node in row) + H_GAP * (len(row) - 1)
        x = (canvas_w - total) / 2
        for node in row:
            node.x = x
            x += node.w + H_GAP
    elements = [box_element(node) for node in nodes]
    channel = max((node.right for node in nodes), default=canvas_w) + 34.0
    for edge in spec.edges:
        a = by_id[edge.src]
        b = by_id[edge.dst]
        if a.level < b.level:
            segments = [(a.cx, a.bottom, b.cx, b.top)]
        elif a.level == b.level and b.x > a.right:
            segments = [(a.right, a.cy, b.left, b.cy)]
        else:
            segments = [(a.right, a.cy, channel, a.cy), (channel, a.cy, channel, b.cy),
                        (channel, b.cy, b.right, b.cy)]
        for index, (x1, y1, x2, y2) in enumerate(segments):
            last = index == len(segments) - 1
            elements.append(line_element(x1, y1, x2, y2, dashed=edge.dashed, arrow=last))
        if edge.label:
            x1, y1, x2, y2 = segments[0]
            width = text_width(edge.label, LABEL_FONT) + 10.0
            elements.append(text_element((x1 + x2) / 2 - width / 2, (y1 + y2) / 2 - 16.0,
                                        width, 14.0, edge.label, LABEL_FONT, color=LINE_COLOR))
    return elements


def layout_org(spec: Spec, canvas_w: float, canvas_h: float) -> list[dict]:
    nodes = spec.nodes
    by_id = {node.id: node for node in nodes}
    for node in nodes:
        measure_node(node)
    children: dict[str, list[Node]] = {node.id: [] for node in nodes}
    roots: list[Node] = []
    for node in nodes:
        if node.parent and node.parent in by_id:
            children[node.parent].append(node)
        else:
            roots.append(node)
    for node in nodes:
        depth, cur = 0, node
        while cur.parent and cur.parent in by_id and depth < len(nodes):
            cur = by_id[cur.parent]
            depth += 1
        node.level = depth
    band: dict[int, float] = {}
    for node in nodes:
        band[node.level] = max(band.get(node.level, 0.0), node.h)
    y = TITLE_SPACE
    for depth in sorted(band):
        for node in nodes:
            if node.level == depth:
                node.y = y
        y += band[depth] + V_GAP
    widths: dict[str, float] = {}

    def subtree_width(node: Node) -> float:
        kids = children[node.id]
        if not kids:
            widths[node.id] = node.w
            return node.w
        total = sum(subtree_width(kid) for kid in kids) + H_GAP * (len(kids) - 1)
        widths[node.id] = max(node.w, total)
        return widths[node.id]

    for root in roots:
        subtree_width(root)
    root_total = sum(widths[root.id] for root in roots) + H_GAP * max(0, len(roots) - 1)
    left = (canvas_w - root_total) / 2

    def place(node: Node, area_left: float) -> None:
        node.x = area_left + (widths[node.id] - node.w) / 2
        kids = children[node.id]
        if not kids:
            return
        kids_total = sum(widths[kid.id] for kid in kids) + H_GAP * (len(kids) - 1)
        cursor = area_left + (widths[node.id] - kids_total) / 2
        for kid in kids:
            place(kid, cursor)
            cursor += widths[kid.id] + H_GAP

    for root in roots:
        place(root, left)
        left += widths[root.id] + H_GAP
    elements = [box_element(node) for node in nodes]
    for node in nodes:
        if node.parent and node.parent in by_id:
            parent = by_id[node.parent]
            elements.append(line_element(parent.cx, parent.bottom, node.cx, node.y))
    return elements


def layout_timeline(spec: Spec, canvas_w: float, canvas_h: float) -> list[dict]:
    nodes = spec.nodes
    for node in nodes:
        measure_node(node)
    count = len(nodes)
    margin = 40.0
    step = (canvas_w - 2 * margin) / count
    axis_y = canvas_h * 0.6
    for index, node in enumerate(nodes):
        node.w = min(node.w, max(60.0, step - 16.0))
        node.lines = wrap_text(node.text, NODE_FONT, node.w - 2 * BOX_PAD_X)
        node.h = len(node.lines) * NODE_FONT * LINE_H + 2 * BOX_PAD_Y
        node.x = margin + step * index + (step - node.w) / 2
        node.y = axis_y - 70.0 - node.h
    elements = [line_element(margin + step * 0.5 - 30.0, axis_y,
                             margin + step * (count - 1) + step * 0.5 + 30.0, axis_y, width=2.0)]
    for index, node in enumerate(nodes):
        marker = {"kind": "box", "shape": "ellipse", "x": node.cx - 9.0, "y": axis_y - 9.0,
                  "w": 18.0, "h": 18.0, "lines": [str(index + 1)], "fill": BOX_LINE,
                  "line": BOX_LINE, "font": 10.0, "bold": True}
        elements.append(marker)
        elements.append(line_element(node.cx, node.bottom, node.cx, axis_y - 9.0,
                                     arrow=False, color=GRAY, width=1.0))
        elements.append(box_element(node))
    return elements


def element_box(element: dict) -> tuple[float, float, float, float]:
    if element["kind"] == "line":
        return (min(element["x1"], element["x2"]), min(element["y1"], element["y2"]),
                max(element["x1"], element["x2"]), max(element["y1"], element["y2"]))
    return (element["x"], element["y"], element["x"] + element["w"], element["y"] + element["h"])


def fit_to_page(elements: list[dict], title: str, canvas_w: float, canvas_h: float, margin: float) -> list[dict]:
    """把整张图缩放平移到页面里，保证不越界。"""
    boxes = [element_box(element) for element in elements]
    if title:
        boxes.append((0.0, 0.0, canvas_w, TITLE_SPACE))
    if not boxes:
        return elements
    min_x = min(box[0] for box in boxes)
    min_y = min(box[1] for box in boxes)
    max_x = max(box[2] for box in boxes)
    max_y = max(box[3] for box in boxes)
    width = max(max_x - min_x, 1.0)
    height = max(max_y - min_y, 1.0)
    avail_w = canvas_w - 2 * margin
    avail_h = canvas_h - 2 * margin
    scale = min(1.0, avail_w / width, avail_h / height)
    shift_x = margin + (avail_w - width * scale) / 2
    shift_y = margin + (avail_h - height * scale) / 2

    def move(x: float, y: float) -> tuple[float, float]:
        return (x - min_x) * scale + shift_x, (y - min_y) * scale + shift_y

    out: list[dict] = []
    for element in elements:
        item = dict(element)
        if item["kind"] == "line":
            item["x1"], item["y1"] = move(item["x1"], item["y1"])
            item["x2"], item["y2"] = move(item["x2"], item["y2"])
            item["width"] = item["width"] * scale
        else:
            item["x"], item["y"] = move(item["x"], item["y"])
            item["w"] = item["w"] * scale
            item["h"] = item["h"] * scale
            item["font"] = item["font"] * scale
            if item["kind"] == "text":
                item["lines"] = wrap_text(" ".join(item["lines"]), item["font"], item["w"])
        out.append(item)
    return out


def build_elements(spec: Spec, page: tuple[float, float], margin: float) -> list[dict]:
    canvas_w = page[0] - 2 * margin
    canvas_h = page[1] - 2 * margin
    if spec.kind == "flow":
        elements = layout_flow(spec, canvas_w, canvas_h)
    elif spec.kind == "org":
        elements = layout_org(spec, canvas_w, canvas_h)
    else:
        elements = layout_timeline(spec, canvas_w, canvas_h)
    elements = fit_to_page(elements, spec.title, canvas_w, canvas_h, margin / 2)
    if spec.title:
        title_w = min(canvas_w, text_width(spec.title, TITLE_FONT) + 40.0)
        elements.insert(0, text_element((canvas_w - title_w) / 2, 0.0, title_w,
                                        TITLE_SPACE - 12.0, spec.title, TITLE_FONT, bold=True))
    return elements


# ---------------------------------------------------------------- 画 PPT

def ppt_font(run, size: float, bold: bool = False, color: str = INK) -> None:
    from pptx.dml.color import RGBColor
    from pptx.oxml.ns import qn
    from pptx.util import Pt

    run.font.name = FONT
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = RGBColor.from_string(color)
    rPr = run._r.get_or_add_rPr()
    for tag in ("a:latin", "a:ea", "a:cs"):
        el = rPr.find(qn(tag))
        if el is None:
            el = rPr.makeelement(qn(tag), {})
            rPr.append(el)
        el.set("typeface", FONT)


def ppt_set_text(shape, lines: list[str], size: float, color: str, bold: bool) -> None:
    from pptx.enum.text import MSO_ANCHOR, PP_ALIGN

    tf = shape.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    tf.clear()
    for index, line in enumerate(lines):
        para = tf.paragraphs[0] if index == 0 else tf.add_paragraph()
        para.alignment = PP_ALIGN.CENTER
        run = para.add_run()
        run.text = line
        ppt_font(run, size, bold, color)


def render_pptx(spec: Spec, elements: list[dict], out_path: Path, offset, into: str = "") -> dict:
    from pptx import Presentation
    from pptx.dml.color import RGBColor
    from pptx.enum.dml import MSO_LINE_DASH_STYLE
    from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
    from pptx.oxml.ns import qn
    from pptx.util import Emu, Pt

    if into:
        prs = Presentation(into)
        slide = prs.slides.add_slide(prs.slide_layouts[6])
    else:
        prs = Presentation()
        slide = prs.slides.add_slide(prs.slide_layouts[6])

    def emu(value: float) -> Emu:
        return Emu(int(round(value * 12700)))

    shape_types = {"roundRect": MSO_SHAPE.ROUNDED_RECTANGLE, "rect": MSO_SHAPE.RECTANGLE,
                   "diamond": MSO_SHAPE.DIAMOND, "ellipse": MSO_SHAPE.OVAL}
    counts = {"shapes": 0, "connectors": 0, "images": 0}
    texts: list[str] = []
    dx, dy = offset
    for element in elements:
        if element["kind"] == "box":
            kind = shape_types.get(element["shape"], MSO_SHAPE.ROUNDED_RECTANGLE)
            shape = slide.shapes.add_shape(kind, emu(element["x"] + dx), emu(element["y"] + dy),
                                           emu(element["w"]), emu(element["h"]))
            shape.fill.solid()
            shape.fill.fore_color.rgb = RGBColor.from_string(element["fill"])
            shape.line.color.rgb = RGBColor.from_string(element["line"])
            shape.line.width = Pt(1.25)
            shape.shadow.inherit = False
            ppt_set_text(shape, element["lines"], element["font"], INK, element.get("bold", False))
            counts["shapes"] += 1
            texts.extend(element["lines"])
        elif element["kind"] == "text":
            box = slide.shapes.add_textbox(emu(element["x"] + dx), emu(element["y"] + dy),
                                           emu(element["w"]), emu(element["h"]))
            ppt_set_text(box, element["lines"], element["font"], element["color"], element.get("bold", False))
            counts["shapes"] += 1
            texts.extend(element["lines"])
        else:
            conn = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, emu(element["x1"] + dx),
                                              emu(element["y1"] + dy), emu(element["x2"] + dx),
                                              emu(element["y2"] + dy))
            conn.line.color.rgb = RGBColor.from_string(element["color"])
            conn.line.width = Pt(element["width"])
            if element["dashed"]:
                conn.line.dash_style = MSO_LINE_DASH_STYLE.DASH
            if element["arrow"]:
                ln = conn.line._get_or_add_ln()
                ln.append(ln.makeelement(qn("a:tailEnd"), {"type": "triangle", "w": "med", "len": "med"}))
            counts["connectors"] += 1
    prs.save(str(out_path))
    return counts, texts


# ---------------------------------------------------------------- 画 Word

DOCX_NS = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
           'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
           'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
           'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" '
           'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"')
PRST = {"roundRect": "roundRect", "rect": "rect", "diamond": "diamond", "ellipse": "ellipse"}


def emu(value: float) -> int:
    return int(round(value * 12700))


def docx_paragraphs(lines: list[str], size: float, color: str, bold: bool) -> str:
    half = int(round(size * 2))
    out = []
    for line in lines:
        text = line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        out.append('<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="0"/></w:pPr>'
                   '<w:r><w:rPr><w:rFonts w:ascii="%s" w:eastAsia="%s" w:hAnsi="%s" w:cs="%s"/>'
                   '<w:color w:val="%s"/><w:sz w:val="%d"/><w:szCs w:val="%d"/>%s</w:rPr>'
                   '<w:t xml:space="preserve">%s</w:t></w:r></w:p>'
                   % (FONT, FONT, FONT, FONT, color, half, half, "<w:b/>" if bold else "", text))
    return "".join(out)


def docx_anchor(inner: str, x: float, y: float, cx: float, cy: float, doc_id: int, name: str) -> str:
    """一个浮动图形：坐标按页面左上角算，Word 里能选中改字。"""
    return ('<w:p %s><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:drawing>'
            '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="%d" '
            'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">'
            '<wp:simplePos x="0" y="0"/>'
            '<wp:positionH relativeFrom="page"><wp:posOffset>%d</wp:posOffset></wp:positionH>'
            '<wp:positionV relativeFrom="page"><wp:posOffset>%d</wp:posOffset></wp:positionV>'
            '<wp:extent cx="%d" cy="%d"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>'
            '<wp:docPr id="%d" name="%s"/><wp:cNvGraphicFramePr/>'
            '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">'
            '%s</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>'
            % (DOCX_NS, 100 + doc_id, emu(x), emu(y), emu(cx), emu(cy), doc_id, name, inner))


def docx_wsp(prst: str, cx: int, cy: int, fill: str, line: str, txbx: str = "",
             ln_extra: str = "", xfrm_extra: str = "") -> str:
    line_xml = '<a:ln w="12700"><a:solidFill><a:srgbClr val="%s"/></a:solidFill>%s</a:ln>' % (line, ln_extra)
    return ('<wps:wsp><wps:cNvSpPr/><wps:spPr>'
            '<a:xfrm%s><a:off x="0" y="0"/><a:ext cx="%d" cy="%d"/></a:xfrm>'
            '<a:prstGeom prst="%s"><a:avLst/></a:prstGeom>'
            '<a:solidFill><a:srgbClr val="%s"/></a:solidFill>%s</wps:spPr>%s'
            '<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" '
            'anchor="ctr" anchorCtr="0"><a:noAutofit/></wps:bodyPr></wps:wsp>'
            % (xfrm_extra, cx, cy, prst, fill, line_xml, txbx))


def docx_shape_xml(element: dict, doc_id: int, dx: float, dy: float) -> str:
    cx = emu(element["w"])
    cy = emu(element["h"])
    txbx = "<wps:txbx><w:txbxContent>%s</w:txbxContent></wps:txbx>" % docx_paragraphs(
        element["lines"], element["font"], INK, element.get("bold", False))
    inner = docx_wsp(PRST.get(element["shape"], "roundRect"), cx, cy, element["fill"],
                     element["line"], txbx)
    return docx_anchor(inner, element["x"] + dx, element["y"] + dy, element["w"],
                       element["h"], doc_id, COPY.t("diagramData.shapeName", n=doc_id))


def docx_line_xml(element: dict, doc_id: int, dx: float, dy: float) -> str:
    x1, y1 = element["x1"] + dx, element["y1"] + dy
    x2, y2 = element["x2"] + dx, element["y2"] + dy
    dxr = x2 - x1
    dyr = y2 - y1
    cx, cy = abs(dxr), abs(dyr)
    off_x, off_y = min(x1, x2), min(y1, y2)
    flip_h = "1" if dxr < 0 else "0"
    flip_v = "1" if dyr < 0 else "0"
    if cx < 0.5:
        cx, off_x, flip_h = 1.0, x1 - 0.5, "0"
    if cy < 0.5:
        cy, off_y, flip_v = 1.0, y1 - 0.5, "0"
    dash = '<a:prstDash val="dash"/>' if element["dashed"] else ""
    tail = '<a:tailEnd type="triangle" w="med" len="med"/>' if element["arrow"] else ""
    inner = docx_wsp("line", emu(cx), emu(cy), "FFFFFF", element["color"], "",
                     ln_extra=dash + tail, xfrm_extra=' flipH="%s" flipV="%s"' % (flip_h, flip_v))
    return docx_anchor(inner, off_x, off_y, cx, cy, doc_id, COPY.t("diagramData.connectorName", n=doc_id))


def docx_text_xml(element: dict, doc_id: int, dx: float, dy: float) -> str:
    """图上的标签在 Word 里用没有边框的文本框表示。"""
    item = dict(element)
    item["shape"] = "rect"
    item["fill"] = "FFFFFF"
    item["line"] = "FFFFFF"
    return docx_shape_xml(item, doc_id, dx, dy)


def render_docx(spec: Spec, elements: list[dict], out_path: Path, into: str = "") -> dict:
    from docx import Document
    from docx.oxml import parse_xml
    from docx.shared import Mm

    doc = Document(into) if into else Document()
    section = doc.sections[0]
    if not into:
        section.page_width = Mm(210)
        section.page_height = Mm(297)
    dx = section.left_margin.pt if section.left_margin else DOCX_MARGIN
    dy = section.top_margin.pt if section.top_margin else DOCX_MARGIN
    counts = {"shapes": 0, "connectors": 0, "images": 0}
    texts: list[str] = []
    body = doc.element.body
    for index, element in enumerate(elements):
        if element["kind"] == "line":
            xml = docx_line_xml(element, index + 1, dx, dy)
            counts["connectors"] += 1
        elif element["kind"] == "text":
            xml = docx_text_xml(element, index + 1, dx, dy)
            counts["shapes"] += 1
            texts.extend(element["lines"])
        else:
            xml = docx_shape_xml(element, index + 1, dx, dy)
            counts["shapes"] += 1
            texts.extend(element["lines"])
        body.append(parse_xml(xml))
    doc.save(str(out_path))
    return counts, texts


# ---------------------------------------------------------------- 降级位图

def chinese_font() -> Path:
    """找一款带中文字的字体：先按系统目录找，再挨个试名字。"""
    roots: list[Path] = []
    for name in ("WINDIR", "SystemRoot"):
        value = os.environ.get(name)
        if value:
            roots.append(Path(value) / "Fonts")
    roots.append(Path("C:/Windows/Fonts"))
    for root in roots:
        for filename in ("msyh.ttc", "msyhl.ttc", "simhei.ttf", "simsun.ttc"):
            candidate = root / filename
            if candidate.exists():
                return candidate
    return roots[0] / "msyh.ttc"


def render_png(elements: list[dict], out_path: Path, page: tuple[float, float], scale: float = 2.0) -> None:
    from PIL import Image, ImageDraw, ImageFont

    image = Image.new("RGB", (int(page[0] * scale), int(page[1] * scale)), "white")
    draw = ImageDraw.Draw(image)
    font_path = chinese_font()
    cache: dict[int, object] = {}

    def font(size: float):
        key = int(size * scale)
        if key not in cache:
            cache[key] = (ImageFont.truetype(str(font_path), max(8, key)) if font_path.exists()
                          else ImageFont.load_default())
        return cache[key]

    def rgb(value: str):
        return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16))

    for element in elements:
        if element["kind"] == "line":
            draw.line([element["x1"] * scale, element["y1"] * scale,
                       element["x2"] * scale, element["y2"] * scale],
                      fill=rgb(element["color"]), width=max(1, int(element["width"] * scale)))
        elif element["kind"] == "text":
            y = element["y"] * scale
            for line in element["lines"]:
                draw.text((element["x"] * scale, y), line, font=font(element["font"]),
                          fill=rgb(element["color"]))
                y += element["font"] * LINE_H * scale
        else:
            box = [element["x"] * scale, element["y"] * scale,
                   (element["x"] + element["w"]) * scale, (element["y"] + element["h"]) * scale]
            outline, fill = rgb(element["line"]), rgb(element["fill"])
            if element["shape"] == "diamond":
                cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
                draw.polygon([(box[0], cy), (cx, box[1]), (box[2], cy), (cx, box[3])],
                             fill=fill, outline=outline)
            elif element["shape"] == "ellipse":
                draw.ellipse(box, fill=fill, outline=outline)
            else:
                draw.rounded_rectangle(box, radius=6 * scale, fill=fill, outline=outline)
            y = box[1] + 4 * scale
            for line in element["lines"]:
                draw.text((box[0] + 4 * scale, y), line, font=font(element["font"]), fill=rgb(INK))
                y += element["font"] * LINE_H * scale
    image.save(str(out_path))


def render_docx_png(spec: Spec, elements: list[dict], out_path: Path) -> dict:
    """Word 里的形状画不稳时的降级：同一套排版用 Pillow 画成图插进去。"""
    from docx import Document
    from docx.shared import Mm

    doc = Document()
    section = doc.sections[0]
    section.page_width = Mm(210)
    section.page_height = Mm(297)
    page = (section.page_width.pt, section.page_height.pt)
    png_path = out_path.with_suffix(".png")
    render_png(elements, png_path, page)
    doc.add_picture(str(png_path), width=Mm(180))
    doc.save(str(out_path))
    return {"shapes": 0, "connectors": 0, "images": 1}


# ---------------------------------------------------------------- 入口

def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=COPY.t("diagram.help"))
    parser.add_argument("spec", help=COPY.t("diagram.helpSpec"))
    parser.add_argument("--out", help=COPY.t("diagram.helpOut"))
    parser.add_argument("--format", choices=["pptx", "docx"], help=COPY.t("diagram.helpFormat"))
    parser.add_argument("--into", help=COPY.t("diagram.helpInto"))
    parser.add_argument("--mode", choices=["shapes", "png"], help=COPY.t("diagram.helpMode"))
    args = parser.parse_args(argv)
    spec_path = Path(args.spec)
    try:
        raw = spec_path.read_text(encoding="utf-8")
    except OSError as err:
        print(json.dumps({"error": COPY.t("diagram.unreadable", error=err)}, ensure_ascii=False))
        return 2
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as err:
        said = COPY.t("diagram.badJson", name=spec_path.name, line=err.lineno, col=err.colno, msg=err.msg)
        print(json.dumps({"error": said}, ensure_ascii=False))
        return 2
    try:
        spec = parse_spec(data)
    except SpecError as err:
        print(json.dumps({"error": str(err)}, ensure_ascii=False))
        return 2
    if args.format:
        spec.out_format = args.format
    if args.mode:
        spec.mode = args.mode
    out_name = args.out or spec.out_file
    if not out_name:
        print(json.dumps({"error": COPY.t("diagram.noOutput")}, ensure_ascii=False))
        return 2
    out_path = Path(out_name)
    if not out_path.is_absolute():
        # 相对路径按图谱文件所在目录算：图谱和成品放一处。
        out_path = (spec_path.parent / out_path).resolve()
    into = args.into or ""
    if into:
        out_path = Path(into)
        spec.out_format = "docx" if out_path.suffix.lower() == ".docx" else "pptx"
    try:
        if spec.out_format == "pptx":
            elements = build_elements(spec, PPT_PAGE, PPT_MARGIN)
            counts, texts = render_pptx(spec, elements, out_path, (PPT_MARGIN, PPT_MARGIN), into)
        elif spec.mode == "png":
            elements = build_elements(spec, DOCX_PAGE, DOCX_MARGIN)
            counts = render_docx_png(spec, elements, out_path)
            texts = []
        else:
            elements = build_elements(spec, DOCX_PAGE, DOCX_MARGIN)
            counts, texts = render_docx(spec, elements, out_path, into)
    except Exception as err:  # 出错也要给人话
        print(json.dumps({"error": COPY.t("diagram.failed", error=f"{type(err).__name__}: {err}")}, ensure_ascii=False))
        return 3
    print(json.dumps({"path": str(out_path), "format": spec.out_format, "type": spec.kind,
                      "shapes": counts["shapes"], "connectors": counts["connectors"],
                      "images": counts["images"], "texts": texts}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
