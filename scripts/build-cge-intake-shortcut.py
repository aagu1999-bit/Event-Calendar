#!/usr/bin/env python3
"""Build Save to CGE tool: one share-sheet button for Instagram OR a screenshot.

Receive URLs + Text + Images (Safari / Apps off). No Get URLs from Input.

  If Get Text contains "http" → GET ?sourceUrl=  (Instagram post link)
  Otherwise → POST the image as a File          (screenshot / camera roll)

JSON Dictionary bodies are what iPhone kept sending empty. The URL goes in
the address bar; the photo is the request file. Server prefers a post link
over a cover slide so Extract can still Apify carousels.
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
    enc_uuid = uid()
    url_resp = uid()
    img_resp = uid()
    if_group = uid()
    as_text = action_output(text_uuid, "Text")
    encoded = action_output(enc_uuid, "URL Encoded Text")
    url_out = action_output(url_resp, "Contents of URL")
    img_out = action_output(img_resp, "Contents of URL")
    get_url = f"{share_url}?sourceUrl="

    actions = [
        action("comment", {
            "WFCommentActionText": (
                "One button. Instagram share → GET the post link. "
                "Screenshot share → POST the photo. Receive URLs, Text, "
                "Images. Safari off. No Get URLs from Input. No JSON."
            ),
        }),
        action("detect.text", {
            "UUID": text_uuid,
            "CustomOutputName": "Text",
            "WFInput": attachment(SHORTCUT_INPUT),
        }),
        action("conditional", {
            "GroupingIdentifier": if_group,
            "WFControlFlowMode": 0,
            "WFCondition": 4,
            "WFConditionalActionString": "http",
            "WFInput": {"Type": "Variable", "Variable": attachment(as_text)},
        }),
        action("urlencode", {
            "UUID": enc_uuid,
            "CustomOutputName": "URL Encoded Text",
            "WFInput": attachment(as_text),
        }),
        action("downloadurl", {
            "UUID": url_resp,
            "WFHTTPMethod": "GET",
            "ShowHeaders": False,
            "WFURL": text(get_url, encoded),
        }),
        action("notification", {
            "WFNotificationActionTitle": "Save to CGE tool",
            "WFNotificationActionBody": text(url_out),
        }),
        action("conditional", {
            "GroupingIdentifier": if_group,
            "WFControlFlowMode": 1,
        }),
        action("downloadurl", {
            "UUID": img_resp,
            "WFURL": share_url,
            "WFHTTPMethod": "POST",
            "ShowHeaders": False,
            "WFHTTPHeaders": dictionary({"Content-Type": text("image/jpeg")}),
            "WFHTTPBodyType": "File",
            "WFRequestVariable": attachment(SHORTCUT_INPUT),
        }),
        action("notification", {
            "WFNotificationActionTitle": "Save to CGE tool",
            "WFNotificationActionBody": text(img_out),
        }),
        action("conditional", {
            "GroupingIdentifier": if_group,
            "WFControlFlowMode": 2,
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
            "WFImageContentItem",
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
