#!/usr/bin/env python3
"""Guardrails: URL path when text has http, else photo encode. No link-picker."""

import plistlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / "build-cge-intake-shortcut.py"
SHARE = "https://eventcalendarcge.replit.app/api/screenshot-pool/share"


def main():
    raw = subprocess.check_output(
        [sys.executable, str(SCRIPT), "--share-url", SHARE],
        stderr=subprocess.STDOUT,
    )
    wf = plistlib.loads(raw)
    ids = [a["WFWorkflowActionIdentifier"] for a in wf["WFWorkflowActions"]]
    classes = wf["WFWorkflowInputContentItemClasses"]

    assert wf["WFWorkflowName"] == "Save to CGE tool", wf["WFWorkflowName"]
    assert "is.workflow.actions.detect.link" not in ids, ids
    assert "is.workflow.actions.openurl" not in ids, ids
    assert "is.workflow.actions.detect.text" in ids, ids
    assert "is.workflow.actions.base64encode" in ids, ids
    assert ids.count("is.workflow.actions.downloadurl") == 2, ids
    assert "is.workflow.actions.conditional" in ids, ids
    assert "WFSafariWebPageContentItem" not in classes, classes
    assert "WFImageContentItem" in classes, classes
    assert "WFURLContentItem" in classes, classes
    assert wf["WFWorkflowTypes"] == ["ActionExtension"], wf["WFWorkflowTypes"]

    posts = [
        a["WFWorkflowActionParameters"]
        for a in wf["WFWorkflowActions"]
        if a["WFWorkflowActionIdentifier"].endswith("downloadurl")
    ]
    keys = []
    for params in posts:
        assert params["WFHTTPMethod"] == "POST"
        assert params["WFURL"] == SHARE
        keys.append([
            item["WFKey"]["Value"]["string"]
            for item in params["WFJSONValues"]["Value"]["WFDictionaryFieldValueItems"]
        ])
    assert keys == [["sourceUrl"], ["imageDataUrl"]], keys
    print("ok")


if __name__ == "__main__":
    main()
