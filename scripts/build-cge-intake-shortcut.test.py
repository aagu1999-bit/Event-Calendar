#!/usr/bin/env python3
"""One button: Instagram GET ?sourceUrl= or screenshot POST File. No JSON, no link-picker."""

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
    assert "is.workflow.actions.conditional" in ids, ids
    assert "is.workflow.actions.detect.text" in ids, ids
    assert "is.workflow.actions.urlencode" in ids, ids
    assert ids.count("is.workflow.actions.downloadurl") == 2, ids
    assert "WFImageContentItem" in classes, classes
    assert "WFURLContentItem" in classes, classes
    assert "WFStringContentItem" in classes, classes
    assert "WFSafariWebPageContentItem" not in classes, classes

    downloads = [
        a["WFWorkflowActionParameters"]
        for a in wf["WFWorkflowActions"]
        if a["WFWorkflowActionIdentifier"].endswith("downloadurl")
    ]
    methods = {d["WFHTTPMethod"] for d in downloads}
    assert methods == {"GET", "POST"}, methods
    get = next(d for d in downloads if d["WFHTTPMethod"] == "GET")
    post = next(d for d in downloads if d["WFHTTPMethod"] == "POST")
    assert "WFJSONValues" not in get and "WFJSONValues" not in post
    assert get["WFURL"]["Value"]["string"].startswith(SHARE + "?sourceUrl="), get["WFURL"]
    assert post["WFHTTPBodyType"] == "File", post
    assert post["WFURL"] == SHARE, post["WFURL"]
    print("ok")


if __name__ == "__main__":
    main()
