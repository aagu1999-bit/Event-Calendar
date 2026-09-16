#!/usr/bin/env python3
"""Build Save to CGE tool: GET the share API with ?sourceUrl=

Instagram's share sheet drops the post link if Images is on, and Shortcuts
JSON POST bodies with magic variables often send empty. This Shortcut only
accepts URLs + text, URL-encodes Shortcut Input, and GETs:

  {share}/api/screenshot-pool/share?sourceUrl=https%3A%2F%2Finstagram.com%2F...

No JSON, no If, no Base64, no Get URLs from Input, no Safari.
Photos/screenshots use /intake on the Home Screen, not this button.
"""

import argparse
import plistlib
import sys
import uuid


def uid():
    return str(uuid.uuid4()).upper()


SHORTCUT_INPUT = {"Type": "ExtensionInput"}


def action_output(output_uuid, name):
    return {"Type": "ActionOutput", "OutputUUID": output_uuid, "OutputName": name}


def attachment(att):
    return {"Value": att, "WFSerializationType": "WFTextTokenAttachment"}


def text(*parts):
    string, ranges = "", {}
    for part in parts:
        if isinstance(part, str):
            string += part
        else:
            ranges[f"{{{len(string)}, 1}}"] = part
            string += "\ufffc"
    return {
        "Value": {"string": string, "attachmentsByRange": ranges},
        "WFSerializationType": "WFTextTokenString",
    }


def action(identifier, params):
    return {
        "WFWorkflowActionIdentifier": f"is.workflow.actions.{identifier}",
        "WFWorkflowActionParameters": params,
    }


def build_workflow(share_url):
    text_uuid = uid()
    enc_uuid = uid()
    resp_uuid = uid()
    as_text = action_output(text_uuid, "Text")
    encoded = action_output(enc_uuid, "URL Encoded Text")
    resp = action_output(resp_uuid, "Contents of URL")
    get_url = f"{share_url}?sourceUrl="

    actions = [
        action("comment", {
            "WFCommentActionText": (
                "Instagram → share → this button. Receive URLs + Text only. "
                "GET sourceUrl. Photos: Home Screen /intake. "
                "No Get URLs from Input. No Images. No JSON POST."
            ),
        }),
        action("detect.text", {
            "UUID": text_uuid,
            "CustomOutputName": "Text",
            "WFInput": attachment(SHORTCUT_INPUT),
        }),
        action("urlencode", {
            "UUID": enc_uuid,
            "CustomOutputName": "URL Encoded Text",
            "WFInput": attachment(as_text),
        }),
        action("downloadurl", {
            "UUID": resp_uuid,
            "WFHTTPMethod": "GET",
            "ShowHeaders": False,
            "WFURL": text(get_url, encoded),
        }),
        action("notification", {
            "WFNotificationActionTitle": "Save to CGE tool",
            "WFNotificationActionBody": text(resp),
        }),
    ]

    return {
        "WFWorkflowClientVersion": "1300.0",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowName": "Save to CGE tool",
        "WFWorkflowIcon": {
            "WFWorkflowIconStartColor": 431817727,
            "WFWorkflowIconGlyphNumber": 59511,
        },
        "WFWorkflowImportQuestions": [],
        "WFWorkflowTypes": ["ActionExtension"],
        "WFWorkflowInputContentItemClasses": [
            "WFURLContentItem",
            "WFStringContentItem",
        ],
        "WFWorkflowHasShortcutInputVariables": True,
        "WFWorkflowActions": actions,
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--share-url", required=True)
    p.add_argument("-o", "--output", default="-")
    args = p.parse_args()
    data = plistlib.dumps(build_workflow(args.share_url), fmt=plistlib.FMT_XML)
    if args.output == "-":
        sys.stdout.buffer.write(data)
    else:
        with open(args.output, "wb") as f:
            f.write(data)


if __name__ == "__main__":
    main()
