#!/usr/bin/env python3
"""Guardrails: GET ?sourceUrl=, no JSON POST, no Images, no link-picker."""

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
    assert "is.workflow.actions.base64encode" not in ids, ids
    assert "is.workflow.actions.conditional" not in ids, ids
    assert "is.workflow.actions.detect.text" in ids, ids
    assert "is.workflow.actions.urlencode" in ids, ids
    assert ids.count("is.workflow.actions.downloadurl") == 1, ids
    assert "WFImageContentItem" not in classes, classes
    assert "WFSafariWebPageContentItem" not in classes, classes
    assert "WFURLContentItem" in classes, classes

    post = next(a for a in wf["WFWorkflowActions"] if a["WFWorkflowActionIdentifier"].endswith("downloadurl"))
    params = post["WFWorkflowActionParameters"]
    assert params["WFHTTPMethod"] == "GET"
    assert "WFJSONValues" not in params, params
    wfurl = params["WFURL"]
    assert wfurl["Value"]["string"].startswith(SHARE + "?sourceUrl="), wfurl
    print("ok")


if __name__ == "__main__":
    main()
