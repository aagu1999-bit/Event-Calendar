#!/usr/bin/env python3
"""Build a share-sheet Shortcut named Save to CGE tool that POSTs the post URL.

Do NOT use Get URLs from Input (detect.link) — that opens iPhone's
"pick links from this page" sheet.

Do NOT accept Images — Receive "Apps and 18 more" made Instagram hand
over the on-screen slide and drop the post URL.

Share sheet types are URL + text only. Shortcut Input is the post link.
One POST, then a banner. Safari never opens.
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


def dictionary(items):
    return {
        "Value": {
            "WFDictionaryFieldValueItems": [
                {"WFItemType": 0, "WFKey": text(key), "WFValue": value}
                for key, value in items.items()
            ]
        },
        "WFSerializationType": "WFDictionaryFieldValue",
    }


def action(identifier, params):
    return {
        "WFWorkflowActionIdentifier": f"is.workflow.actions.{identifier}",
        "WFWorkflowActionParameters": params,
    }


def build_workflow(share_url):
    text_uuid = uid()
    resp_uuid = uid()
    as_text = action_output(text_uuid, "Text")
    resp = action_output(resp_uuid, "Contents of URL")

    actions = [
        action("comment", {
            "WFCommentActionText": (
                "Save to CGE tool. Instagram → share → this button. "
                "Sends the post link. Do not open the website. "
                "Receive URLs only — not Apps and 18 more / Images."
            ),
        }),
        # Stringify Shortcut Input (a URL content item) so the JSON is a real href.
        action("detect.text", {
            "UUID": text_uuid,
            "CustomOutputName": "Text",
            "WFInput": attachment(SHORTCUT_INPUT),
        }),
        action("downloadurl", {
            "UUID": resp_uuid,
            "WFURL": share_url,
            "WFHTTPMethod": "POST",
            "ShowHeaders": False,
            "WFHTTPBodyType": "JSON",
            "WFJSONValues": dictionary({
                "sourceUrl": text(as_text),
            }),
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
        # URL + text only. Images would make iOS hand over the on-screen
        # slide and drop the post link. Safari web pages are off so iOS
        # does not open the "pick links from this page" sheet.
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
