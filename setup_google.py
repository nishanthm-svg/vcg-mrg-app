"""
VCG/MRG App - Automated Google Setup
=====================================
This script:
1. Opens Google login in your browser (one-time)
2. Creates a Google Sheet for data storage
3. Deploys a Google Apps Script as API
4. Writes the URL into the app config

Run:  python setup_google.py
Requires: pip install google-auth-oauthlib google-api-python-client
"""

import os, sys, json, time, webbrowser
sys.stdout.reconfigure(encoding='utf-8')

APP_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Check dependencies ─────────────────────────────────────────────────────
def check_deps():
    missing = []
    try: import googleapiclient
    except ImportError: missing.append("google-api-python-client")
    try: import google_auth_oauthlib
    except ImportError: missing.append("google-auth-oauthlib")
    if missing:
        print("Installing required packages...")
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install"] + missing)
        print("✅ Packages installed. Restarting...")
        os.execv(sys.executable, [sys.executable] + sys.argv)

check_deps()

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

# ── Scopes ─────────────────────────────────────────────────────────────────
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.projects",
    "https://www.googleapis.com/auth/script.deployments",
    "https://www.googleapis.com/auth/drive.file",
]

# ── OAuth client config (public installed-app credentials for local use) ───
# These are generic credentials for local desktop scripts.
# Your data stays in YOUR Google account — this script only creates files there.
CLIENT_CONFIG = {
    "installed": {
        "client_id": "YOUR_OAUTH_CLIENT_ID",
        "client_secret": "YOUR_OAUTH_CLIENT_SECRET",
        "redirect_uris": ["urn:ietf:wg:oauth:2.0:oob", "http://localhost"],
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
    }
}

# ── Apps Script source ─────────────────────────────────────────────────────
GAS_CODE = open(os.path.join(APP_DIR, "google-apps-script.js")).read()

APPSSCRIPT_JSON = json.dumps({
    "timeZone": "Asia/Kolkata",
    "dependencies": {},
    "exceptionLogging": "STACKDRIVER",
    "runtimeVersion": "V8",
    "webapp": {
        "executeAs": "USER_DEPLOYING",
        "access": "ANYONE_ANONYMOUS"
    }
})


def get_credentials():
    token_file = os.path.join(APP_DIR, ".token.json")
    creds = None

    if os.path.exists(token_file):
        creds = Credentials.from_authorized_user_file(token_file, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            # Check if user provided credentials file
            creds_file = os.path.join(APP_DIR, "credentials.json")
            if os.path.exists(creds_file):
                flow = InstalledAppFlow.from_client_secrets_file(creds_file, SCOPES)
            else:
                print("\n⚠️  No credentials.json found.")
                print("   Please follow the ONE-TIME setup below:\n")
                show_credential_instructions()
                sys.exit(1)

            creds = flow.run_local_server(port=0)

        with open(token_file, "w") as f:
            f.write(creds.to_json())

    return creds


def show_credential_instructions():
    print("=" * 60)
    print("ONE-TIME GOOGLE SETUP (takes ~3 minutes)")
    print("=" * 60)
    print("""
STEP 1: Create a Google Cloud Project
  → Go to: https://console.cloud.google.com/
  → Click 'Select Project' → 'New Project'
  → Name it: VCG-MRG-App → Click Create

STEP 2: Enable APIs
  → Go to: APIs & Services → Enable APIs
  → Search and enable:
    • Google Sheets API
    • Google Apps Script API
    • Google Drive API

STEP 3: Create OAuth Credentials
  → Go to: APIs & Services → Credentials
  → Click: + Create Credentials → OAuth 2.0 Client IDs
  → Application type: Desktop App
  → Name: VCG-MRG Setup
  → Click Create → Download JSON

STEP 4: Save the file
  → Rename the downloaded file to: credentials.json
  → Copy it into this folder:
    """ + APP_DIR + """

STEP 5: Run this script again
  → python setup_google.py
  → A browser will open → click Allow
  → Everything will be set up automatically!
""")
    print("=" * 60)
    # Open relevant pages
    try:
        webbrowser.open("https://console.cloud.google.com/")
    except:
        pass


def create_spreadsheet(sheets_svc):
    print("\n📊 Creating Google Sheet...")
    spreadsheet = {
        "properties": {"title": "VCG MRG Identifications 2025"},
        "sheets": [
            {"properties": {"title": "Identifications", "index": 0}},
            {"properties": {"title": "Progress", "index": 1}},
            {"properties": {"title": "Config", "index": 2}},
        ]
    }
    result = sheets_svc.spreadsheets().create(body=spreadsheet).execute()
    sheet_id = result["spreadsheetId"]
    sheet_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit"
    print(f"   ✅ Sheet created: {sheet_url}")

    # Add headers to Identifications sheet
    headers = [[
        "Unkey", "Executive", "MPP Code", "MPP Name", "Member Code",
        "Member Name", "ACO Name", "Plant Code", "Type (VCG/MRG)",
        "Form Number", "Meeting Date", "Group Members", "Total Days",
        "Total Qty (L)", "Last FY VCG/MRG", "Submitted At", "Synced"
    ]]
    sheets_svc.spreadsheets().values().update(
        spreadsheetId=sheet_id,
        range="Identifications!A1",
        valueInputOption="RAW",
        body={"values": headers}
    ).execute()

    # Get actual sheetId for first sheet
    sheet_meta = sheets_svc.spreadsheets().get(spreadsheetId=sheet_id).execute()
    first_sheet_id = sheet_meta["sheets"][0]["properties"]["sheetId"]

    # Format headers (bold + color)
    requests = [{
        "repeatCell": {
            "range": {"sheetId": first_sheet_id, "startRowIndex": 0, "endRowIndex": 1},
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": {"red": 0.102, "green": 0.137, "blue": 0.494},
                    "textFormat": {"foregroundColor": {"red": 1, "green": 1, "blue": 1}, "bold": True}
                }
            },
            "fields": "userEnteredFormat(backgroundColor,textFormat)"
        }
    }, {
        "updateSheetProperties": {
            "properties": {"sheetId": first_sheet_id, "gridProperties": {"frozenRowCount": 1}},
            "fields": "gridProperties.frozenRowCount"
        }
    }]
    sheets_svc.spreadsheets().batchUpdate(
        spreadsheetId=sheet_id, body={"requests": requests}
    ).execute()

    print("   ✅ Headers and formatting applied")
    return sheet_id, sheet_url


def deploy_apps_script(script_svc, sheet_id):
    print("\n⚙️  Deploying Google Apps Script...")

    # Create project
    project = script_svc.projects().create(body={
        "title": "VCG-MRG-API",
        "parentId": sheet_id
    }).execute()
    script_id = project["scriptId"]
    print(f"   ✅ Script project created")

    # Inject sheet ID into script
    gas_with_id = GAS_CODE.replace("YOUR_GOOGLE_SHEET_ID_HERE", sheet_id)

    # Update script content
    script_svc.projects().updateContent(
        scriptId=script_id,
        body={
            "files": [
                {
                    "name": "Code",
                    "type": "SERVER_JS",
                    "source": gas_with_id
                },
                {
                    "name": "appsscript",
                    "type": "JSON",
                    "source": APPSSCRIPT_JSON
                }
            ]
        }
    ).execute()
    print("   ✅ Script code uploaded")

    # Create a version first (required before deployment)
    version = script_svc.projects().versions().create(
        scriptId=script_id,
        body={"description": "VCG-MRG API v1"}
    ).execute()
    version_number = version["versionNumber"]
    print(f"   ✅ Version {version_number} created")

    # Deploy as web app from that version
    deployment = script_svc.projects().deployments().create(
        scriptId=script_id,
        body={
            "versionNumber": version_number,
            "manifestFileName": "appsscript",
            "description": "VCG-MRG API v1"
        }
    ).execute()

    deployment_id = deployment["deploymentId"]
    gas_url = f"https://script.google.com/macros/s/{deployment_id}/exec"
    print(f"   ✅ Web App deployed")
    return gas_url, script_id


def save_config(gas_url, sheet_url, sheet_id):
    """Save GAS URL to app config so the app picks it up automatically."""
    config = {
        "gasUrl": gas_url,
        "sheetUrl": sheet_url,
        "sheetId": sheet_id,
        "configured": True,
        "configuredAt": time.strftime("%Y-%m-%dT%H:%M:%S")
    }
    config_path = os.path.join(APP_DIR, "config.json")
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)
    print(f"\n   ✅ Config saved to app")

    # Also patch app.js to pre-load the GAS URL
    app_js_path = os.path.join(APP_DIR, "app.js")
    with open(app_js_path, "r") as f:
        content = f.read()

    # Inject the URL as default
    patched = content.replace(
        "state.gasUrl = null;",
        f"state.gasUrl = '{gas_url}'; // auto-configured"
    )
    if patched != content:
        with open(app_js_path, "w") as f:
            f.write(patched)
        print("   ✅ app.js updated with GAS URL")


def main():
    print("\n" + "=" * 60)
    print("  VCG/MRG App — Automated Google Setup")
    print("=" * 60)

    # Check credentials
    creds_file = os.path.join(APP_DIR, "credentials.json")
    if not os.path.exists(creds_file):
        show_credential_instructions()
        return

    print("\n🔐 Opening Google login in browser...")
    print("   → Please sign in and click 'Allow'")
    creds = get_credentials()

    sheets_svc = build("sheets", "v4", credentials=creds)
    script_svc = build("script", "v1", credentials=creds)

    try:
        # Reuse existing sheet if already created
        existing_cfg = os.path.join(APP_DIR, "config.json")
        if os.path.exists(existing_cfg):
            with open(existing_cfg) as f:
                prev = json.load(f)
            if prev.get("sheetId"):
                print(f"\n[i] Reusing existing sheet: {prev['sheetUrl']}")
                sheet_id, sheet_url = prev["sheetId"], prev["sheetUrl"]
            else:
                sheet_id, sheet_url = create_spreadsheet(sheets_svc)
        else:
            sheet_id, sheet_url = create_spreadsheet(sheets_svc)
        gas_url, script_id = deploy_apps_script(script_svc, sheet_id)
        save_config(gas_url, sheet_url, sheet_id)

        print("\n" + "=" * 60)
        print("  ✅ SETUP COMPLETE!")
        print("=" * 60)
        print(f"""
📊 Google Sheet: {sheet_url}
🔗 API URL: {gas_url}

The app is now fully configured.
Share the vcg-mrg-app folder with your field executives.

Opening your Google Sheet now...
""")
        webbrowser.open(sheet_url)

    except HttpError as e:
        print(f"\n❌ Error: {e}")
        if "PERMISSION_DENIED" in str(e):
            print("\n→ Make sure you enabled these APIs in Google Cloud Console:")
            print("  • Google Sheets API")
            print("  • Google Apps Script API")
            print("  • Google Drive API")
        elif "Script API" in str(e):
            print("\n→ Apps Script API needs to be enabled:")
            print("  Go to: https://console.cloud.google.com/apis/library/script.googleapis.com")
            webbrowser.open("https://console.cloud.google.com/apis/library/script.googleapis.com")


if __name__ == "__main__":
    main()
