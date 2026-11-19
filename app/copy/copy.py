"""桌伴的固定文案：Python 这边读跟 copy.mjs 同一批文件（errors / status / harness / ui-desk / ui-settings / ui-windows 的 .mjs）。

用法：别 import copy（会盖住标准库的 copy），按文件路径载进来：

    spec = importlib.util.spec_from_file_location("sidemate_copy", <app/copy/copy.py>)

然后 t("files.text", {files="…"})、t("diagram.notObject")。找不到键就报错。
"""
from __future__ import annotations

import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
BOOKS = ("errors", "status", "harness", "ui-desk", "ui-settings", "ui-windows")
REF = re.compile(r"^@([\w.]+)$")
VAR = re.compile(r"\{([A-Za-z][A-Za-z0-9]*)\}")

_ALL: dict | None = None


def parse_book(src: str) -> dict:
    """读一个 .mjs 文案文件：去掉 export default、注释和收尾多余的逗号，剩下的就是 JSON。"""
    body = src[src.index("export default") + len("export default"):]
    out = []
    i = 0
    in_string = False
    while i < len(body):
        c = body[i]
        if in_string:
            out.append(c)
            if c == "\\":
                out.append(body[i + 1])
                i += 2
                continue
            if c == '"':
                in_string = False
            i += 1
            continue
        if c == '"':
            in_string = True
        elif body.startswith("//", i):
            end = body.find("\n", i)
            i = len(body) if end < 0 else end
            continue
        elif body.startswith("/*", i):
            end = body.find("*/", i + 2)
            i = len(body) if end < 0 else end + 2
            continue
        elif c in "}]":
            # 收尾多余的逗号：往回跳过空白，是逗号就去掉
            j = len(out) - 1
            while j >= 0 and out[j].isspace():
                j -= 1
            if j >= 0 and out[j] == ",":
                del out[j]
        out.append(c)
        i += 1
    return json.loads("".join(out).strip().rstrip(";"))


def _all() -> dict:
    global _ALL
    if _ALL is None:
        merged: dict = {}
        for name in BOOKS:
            merged.update(parse_book((HERE / f"{name}.mjs").read_text(encoding="utf-8")))
        _ALL = merged
    return _ALL


def _find(key: str):
    node = _all()
    for part in str(key).split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def raw(key: str, seen: tuple = ()) -> str:
    node = _find(key)
    if node is None:
        raise KeyError(f"app/copy 里没有「{key}」这一条")
    if isinstance(node, str):
        text = node
    elif isinstance(node, dict) and isinstance(node.get("text"), str):
        text = node["text"]
    elif isinstance(node, dict) and isinstance(node.get("lines"), list):
        text = "\n".join(node["lines"])
    else:
        raise KeyError(f"app/copy 里「{key}」不是一句话")
    ref = REF.match(text)
    if not ref:
        return text
    if key in seen:
        raise KeyError(f"app/copy 里「{key}」转来转去转回自己了")
    return raw(ref.group(1), seen + (key,))


def fill(text: str, **values) -> str:
    """给了的变量换上，没给的原样留着。"""
    return VAR.sub(lambda m: str(values[m.group(1)]) if values.get(m.group(1)) is not None else m.group(0), text)


def t(key: str, **values) -> str:
    return fill(raw(key), **values)


def lines(key: str) -> list[str]:
    return raw(key).split("\n")
