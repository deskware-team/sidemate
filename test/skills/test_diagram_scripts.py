"""「画流程图」技能脚本的用例；用随包 Python 运行本文件。"""

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "app" / "skills-recommended" / "sidemate-diagram" / "scripts" / "draw_diagram.py"

FLOW = {
    "type": "flow",
    "title": "报销审批流程",
    "nodes": [
        {"id": "n1", "text": "员工提出申请"},
        {"id": "n2", "text": "直属主管审核"},
        {"id": "n3", "text": "金额超过 5000 元？", "shape": "diamond"},
        {"id": "n4", "text": "财务总监加签"},
        {"id": "n5", "text": "出纳打款"},
    ],
    "edges": [
        {"from": "n1", "to": "n2", "label": "提交"},
        {"from": "n2", "to": "n3", "label": "通过"},
        {"from": "n3", "to": "n4", "label": "是"},
        {"from": "n4", "to": "n5", "label": "通过"},
        {"from": "n3", "to": "n2", "label": "驳回", "style": "dashed"},
    ],
    "output": {"format": "pptx", "file": "flow.pptx"},
}

ORG = {
    "type": "org",
    "title": "项目分工",
    "nodes": [
        {"id": "root", "text": "项目负责人"},
        {"id": "a", "text": "内容组（文案 2 人、设计 1 人）", "parent": "root"},
        {"id": "b", "text": "技术组（后端 2 人、前端 1 人）", "parent": "root"},
        {"id": "c", "text": "文案组", "parent": "a"},
        {"id": "d", "text": "设计组", "parent": "a"},
    ],
    "output": {"format": "docx", "file": "org.docx"},
}

TIMELINE = {
    "type": "timeline",
    "title": "项目时间线",
    "nodes": [
        {"id": "t1", "text": "立项"},
        {"id": "t2", "text": "需求评审"},
        {"id": "t3", "text": "开发"},
        {"id": "t4", "text": "上线"},
    ],
    "output": {"format": "pptx", "file": "timeline.pptx"},
}

EMU = 12700  # 1 pt


def run_script(spec, out_name, tmpdir, extra=None):
    """跑一次脚本，返回 (退出码, 标准输出 JSON)。"""
    spec = dict(spec)
    spec["output"] = dict(spec.get("output", {}))
    spec["output"]["file"] = out_name
    path = Path(tmpdir) / "spec.json"
    path.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
    cmd = [sys.executable, str(SCRIPT), str(path)]
    if extra:
        cmd.extend(extra)
    done = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=180, cwd=tmpdir)
    try:
        payload = json.loads(done.stdout.strip().splitlines()[-1]) if done.stdout.strip() else {}
    except (ValueError, IndexError):
        payload = {}
    return done.returncode, payload, done.stdout


def pptx_parts(path):
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        slide = zf.read("ppt/slides/slide1.xml").decode("utf-8")
        media = [name for name in names if name.startswith("ppt/media/")]
    return slide, media


def docx_xml(path):
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        document = zf.read("word/document.xml").decode("utf-8")
        media = [name for name in names if name.startswith("word/media/")]
    return document, media


def shape_boxes(slide_xml):
    """取出每个形状的 (x, y, 宽, 高)，单位 pt。"""
    boxes = []
    for match in re.finditer(r"<a:off x=\"(-?\d+)\" y=\"(-?\d+)\"/><a:ext cx=\"(\d+)\" cy=\"(\d+)\"/>", slide_xml):
        x, y, cx, cy = (int(value) for value in match.groups())
        boxes.append((x / EMU, y / EMU, cx / EMU, cy / EMU))
    return boxes


class DiagramScriptTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def test_flow_pptx_has_editable_shapes(self):
        code, payload, _ = run_script(FLOW, "flow.pptx", self.dir)
        self.assertEqual(code, 0, payload)
        self.assertEqual(payload["images"], 0, "pptx 里不该有位图")
        self.assertGreaterEqual(payload["shapes"], 6)
        self.assertGreaterEqual(payload["connectors"], 4)
        out = Path(payload["path"])
        slide, media = pptx_parts(out)
        self.assertEqual(media, [], "pptx 里不该有图片文件")
        self.assertGreaterEqual(slide.count("<p:sp>"), 6)
        self.assertGreaterEqual(slide.count("<p:cxnSp>"), 4)
        for text in ("员工提出申请", "直属主管审核", "财务总监加签", "出纳打款", "驳回"):
            self.assertIn(text, slide)

    def test_flow_shapes_stay_inside_the_slide(self):
        code, payload, _ = run_script(FLOW, "flow.pptx", self.dir)
        self.assertEqual(code, 0, payload)
        slide, _ = pptx_parts(Path(payload["path"]))
        for x, y, width, height in shape_boxes(slide):
            self.assertGreaterEqual(x, -0.5, "形状左边超出页面")
            self.assertGreaterEqual(y, -0.5, "形状上边超出页面")
            self.assertLessEqual(x + width, 720.5, "形状右边超出页面")
            self.assertLessEqual(y + height, 540.5, "形状下边超出页面")

    def test_dashed_loop_edge_exists(self):
        code, payload, _ = run_script(FLOW, "flow.pptx", self.dir)
        self.assertEqual(code, 0, payload)
        slide, _ = pptx_parts(Path(payload["path"]))
        self.assertIn('val="dash"', slide, "回路那条线要画成虚线")

    def test_long_text_wraps_and_box_grows(self):
        spec = {
            "type": "flow",
            "title": "长字",
            "nodes": [
                {"id": "s", "text": "短"},
                {"id": "l", "text": "这是一段很长的说明文字，用来检查换行和框子长高是不是都做到了"},
            ],
            "edges": [{"from": "s", "to": "l"}],
            "output": {"format": "pptx", "file": "long.pptx"},
        }
        code, payload, _ = run_script(spec, "long.pptx", self.dir)
        self.assertEqual(code, 0, payload)
        slide, _ = pptx_parts(Path(payload["path"]))
        texts = re.findall(r"<a:t>([^<]*)</a:t>", slide)
        joined = "".join(texts)
        self.assertIn("这是一段很长的说明文字", joined, "长字要出现在图里")
        pieces = [text for text in texts if text and text in "这是一段很长的说明文字，用来检查换行和框子长高是不是都做到了"]
        self.assertGreater(len(pieces), 1, "长字要断成几行")
        boxes = shape_boxes(slide)
        heights = [height for _, _, _, height in boxes]
        self.assertGreater(max(heights), min(heights), "长字的框要更高")

    def test_org_docx_has_shapes_and_text(self):
        code, payload, _ = run_script(ORG, "org.docx", self.dir)
        self.assertEqual(code, 0, payload)
        document, media = docx_xml(Path(payload["path"]))
        self.assertEqual(media, [], "docx 里不该有图片文件")
        self.assertGreaterEqual(document.count("<wps:wsp>"), 5)
        for text in ("项目负责人", "内容组", "技术组", "文案组", "设计组"):
            self.assertIn(text, document)
        self.assertIn("微软雅黑", document)

    def test_timeline_pptx_has_axis_and_milestones(self):
        code, payload, _ = run_script(TIMELINE, "timeline.pptx", self.dir)
        self.assertEqual(code, 0, payload)
        slide, media = pptx_parts(Path(payload["path"]))
        self.assertEqual(media, [])
        self.assertGreaterEqual(slide.count("<p:sp>"), 5)
        self.assertGreaterEqual(slide.count("<p:cxnSp>"), 1)
        for text in ("立项", "需求评审", "开发", "上线"):
            self.assertIn(text, slide)

    def test_bad_json_gives_human_message(self):
        path = Path(self.dir) / "bad.json"
        path.write_text('{"type": "flow", "nodes": [', encoding="utf-8")
        done = subprocess.run(
            [sys.executable, str(SCRIPT), str(path)], capture_output=True, text=True, encoding="utf-8", timeout=60, cwd=self.dir
        )
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("JSON", done.stdout)

    def test_unknown_node_in_edge_gives_human_message(self):
        spec = dict(FLOW)
        spec["edges"] = [{"from": "n1", "to": "nope"}]
        path = Path(self.dir) / "bad_edge.json"
        path.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
        done = subprocess.run(
            [sys.executable, str(SCRIPT), str(path)], capture_output=True, text=True, encoding="utf-8", timeout=60, cwd=self.dir
        )
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("nope", done.stdout)

    def test_bad_shape_gives_human_message(self):
        spec = dict(FLOW)
        spec["nodes"] = [{"id": "n1", "text": "甲", "shape": "star"}]
        path = Path(self.dir) / "bad_shape.json"
        path.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
        done = subprocess.run(
            [sys.executable, str(SCRIPT), str(path)], capture_output=True, text=True, encoding="utf-8", timeout=60, cwd=self.dir
        )
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("shape", done.stdout)

    def test_insert_into_existing_docx_and_pptx(self):
        code, payload, _ = run_script(FLOW, "flow.pptx", self.dir)
        self.assertEqual(code, 0, payload)
        base = Path(payload["path"])
        code, payload, _ = run_script(ORG, "org.docx", self.dir)
        self.assertEqual(code, 0, payload)
        docx_base = Path(payload["path"])
        # 插进已有的 pptx 和 docx 末尾
        code, payload, _ = run_script(FLOW, "flow2.pptx", self.dir, extra=["--into", str(base)])
        self.assertEqual(code, 0, payload)
        with zipfile.ZipFile(base) as zf:
            slides = [name for name in zf.namelist() if re.match(r"ppt/slides/slide\d+\.xml", name)]
        self.assertGreaterEqual(len(slides), 2, "插进已有 pptx 要多出一页")
        code, payload, _ = run_script(ORG, "org2.docx", self.dir, extra=["--into", str(docx_base)])
        self.assertEqual(code, 0, payload)
        document, _ = docx_xml(docx_base)
        self.assertIn("内容组", document)


if __name__ == "__main__":
    unittest.main()
