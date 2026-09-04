#!/usr/bin/env python3
"""Build an unsigned CGE Intake shortcut that prefers the Instagram post URL.

The old "Save to CGE tool" shortcut only received Images, so Instagram's
share sheet handed it a preview (often an empty data-URL) and dropped the
post link. This one accepts URLs + text + Safari pages + images, pulls
URLs from the share, and POSTs { sourceUrl } to the pool.

Usage:
  python3 scripts/build-cge-intake-shortcut.py --share-url https://example.com/api/screenshot-pool/share
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
    urls_uuid = uid()
    first_uuid = uid()
    resp_uuid = uid()
    if_group = uid()

    urls = action_output(urls_uuid, "URLs")
    first = action_output(first_uuid, "Item from List")
    resp = action_output(resp_uuid, "Contents of URL")

    actions = [
        action("comment", {
            "WFCommentActionText": (
                "CGE Intake (URL-first). Share an Instagram POST so the link "
                "comes through. If the share is only a photo, Copy Link on "
                "the post and share that."
            ),
        }),
        action("detect.link", {
            "UUID": urls_uuid,
            "CustomOutputName": "URLs",
            "WFInput": attachment(SHORTCUT_INPUT),
        }),
        action("getitemfromlist", {
            "UUID": first_uuid,
            "CustomOutputName": "Item from List",
            "WFItemSpecifier": "First Item",
            "WFInput": attachment(urls),
        }),
        action("conditional", {
            "UUID": uid(),
            "GroupingIdentifier": if_group,
            "WFControlFlowMode": 0,
            "WFCondition": 100,
            "WFInput": {"Type": "Variable", "Variable": attachment(first)},
        }),
        action("downloadurl", {
            "UUID": resp_uuid,
            "WFURL": share_url,
            "WFHTTPMethod": "POST",
            "ShowHeaders": False,
            "WFHTTPBodyType": "JSON",
            "WFJSONValues": dictionary({
                "sourceUrl": text(first),
            }),
        }),
        action("notification", {
            "WFNotificationActionTitle": "CGE Intake",
            "WFNotificationActionBody": text(resp),
        }),
        action("conditional", {
            "UUID": uid(),
            "GroupingIdentifier": if_group,
            "WFControlFlowMode": 1,
        }),
        action("notification", {
            "WFNotificationActionTitle": "CGE Intake",
            "WFNotificationActionBody": (
                "No Instagram link in that share. On the post tap ••• → Copy link, "
                "then share the link to CGE Intake."
            ),
        }),
        action("conditional", {
            "UUID": uid(),
            "GroupingIdentifier": if_group,
            "WFControlFlowMode": 2,
        }),
    ]

    return {
        "WFWorkflowClientVersion": "1300.0",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowName": "CGE Intake",
        "WFWorkflowIcon": {
            "WFWorkflowIconStartColor": 431817727,
            "WFWorkflowIconGlyphNumber": 59511,
        },
        "WFWorkflowImportQuestions": [],
        "WFWorkflowTypes": ["ActionExtension", "NCWidget"],
        # URL + Safari page + text so Instagram's post link is not dropped.
        # Images still accepted so the shortcut appears on photo shares.
        "WFWorkflowInputContentItemClasses": [
            "WFURLContentItem",
            "WFSafariWebPageContentItem",
            "WFArticleContentItem",
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
