#!/usr/bin/env python3
"""Guardrails for the share-sheet Shortcut: no link-picker, no image intake."""

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
    assert "is.workflow.actions.downloadurl" in ids, ids
    assert "WFImageContentItem" not in classes, classes
    assert "WFSafariWebPageContentItem" not in classes, classes
    assert "WFURLContentItem" in classes, classes
    assert wf["WFWorkflowTypes"] == ["ActionExtension"], wf["WFWorkflowTypes"]

    post = next(a for a in wf["WFWorkflowActions"] if a["WFWorkflowActionIdentifier"].endswith("downloadurl"))
    params = post["WFWorkflowActionParameters"]
    assert params["WFHTTPMethod"] == "POST"
    assert params["WFURL"] == SHARE
    keys = [
        item["WFKey"]["Value"]["string"]
        for item in params["WFJSONValues"]["Value"]["WFDictionaryFieldValueItems"]
    ]
    assert keys == ["sourceUrl"], keys
    print("ok")


if __name__ == "__main__":
    main()
