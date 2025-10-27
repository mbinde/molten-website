#!/bin/bash
#
# Refresh iOS App Stores Data
#
# Downloads the latest stores.json from moltenglass.app and copies it to the iOS app bundle.
# Run this after approving new stores in the admin panel to update the bundled fallback data.
#

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔄 Refreshing iOS App Store Data...${NC}"
echo ""

# Define paths
WEB_URL="https://moltenglass.app/stores.json"
IOS_REPO_PATH="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Molten"
IOS_BUNDLE_PATH="$IOS_REPO_PATH/Molten/Sources/Resources/stores.json"
TEMP_FILE="/tmp/stores-download.json"

# Step 1: Download from web
echo -e "${BLUE}📥 Downloading from ${WEB_URL}...${NC}"
if curl -f -s "$WEB_URL" -o "$TEMP_FILE"; then
    echo -e "${GREEN}✅ Downloaded successfully${NC}"
else
    echo -e "${RED}❌ Failed to download stores.json from web${NC}"
    echo -e "${YELLOW}   Make sure you've generated stores.json in the admin panel${NC}"
    exit 1
fi

# Step 2: Validate JSON
echo ""
echo -e "${BLUE}🔍 Validating JSON...${NC}"
if python3 -m json.tool "$TEMP_FILE" > /dev/null 2>&1; then
    # Extract stats from JSON
    STORE_COUNT=$(python3 -c "import json; data=json.load(open('$TEMP_FILE')); print(data.get('store_count', 0))")
    VERSION=$(python3 -c "import json; data=json.load(open('$TEMP_FILE')); print(data.get('version', 'unknown'))")
    GENERATED=$(python3 -c "import json; data=json.load(open('$TEMP_FILE')); print(data.get('generated', 'unknown'))")

    echo -e "${GREEN}✅ Valid JSON${NC}"
    echo -e "   Version: ${VERSION}"
    echo -e "   Generated: ${GENERATED}"
    echo -e "   Store count: ${STORE_COUNT}"
else
    echo -e "${RED}❌ Invalid JSON format${NC}"
    exit 1
fi

# Step 3: Copy to iOS repo
echo ""
echo -e "${BLUE}📋 Copying to iOS app bundle...${NC}"
if [ ! -d "$IOS_REPO_PATH" ]; then
    echo -e "${RED}❌ iOS repo not found at: ${IOS_REPO_PATH}${NC}"
    exit 1
fi

# Create directory if needed
mkdir -p "$(dirname "$IOS_BUNDLE_PATH")"

# Copy file
cp "$TEMP_FILE" "$IOS_BUNDLE_PATH"
echo -e "${GREEN}✅ Copied to: ${IOS_BUNDLE_PATH}${NC}"

# Step 4: Show git status
echo ""
echo -e "${BLUE}📊 Git status:${NC}"
cd "$IOS_REPO_PATH"
git diff --stat Molten/Sources/Resources/stores.json || true

# Step 5: Summary
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Success! Bundled stores.json updated${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "   1. cd \"$IOS_REPO_PATH\""
echo -e "   2. git add Molten/Sources/Resources/stores.json"
echo -e "   3. git commit -m \"Update bundled stores.json with \$STORE_COUNT stores\""
echo -e "   4. Rebuild the iOS app to include the new data"
echo ""
echo -e "${BLUE}ℹ️  Note: The app will still fetch fresh data from the web on launch.${NC}"
echo -e "${BLUE}   This bundled file is just an offline fallback.${NC}"
echo ""

# Cleanup
rm -f "$TEMP_FILE"
