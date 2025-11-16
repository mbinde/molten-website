#!/bin/bash

# Test script for image submission API endpoint
# Usage: ./test-submit-image.sh [local|production]

ENV=${1:-local}

if [ "$ENV" = "local" ]; then
  URL="http://localhost:4321/api/v1/submit-image"
else
  URL="https://moltenapp.com/api/v1/submit-image"
fi

echo "Testing image submission endpoint: $URL"
echo ""

# Create a tiny base64 test image (1x1 pixel PNG)
TEST_IMAGE="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

# Test 1: Valid submission
echo "Test 1: Valid submission"
curl -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{
    "glassItem": {
      "stable_id": "test-001-0",
      "name": "Test Glass",
      "manufacturer": "test",
      "code": "001"
    },
    "email": "test@example.com",
    "image": "'"$TEST_IMAGE"'",
    "hasPermission": true,
    "offersFreeOfCharge": true
  }' | jq '.'
echo ""
echo "---"
echo ""

# Test 2: Missing email
echo "Test 2: Missing email (should fail)"
curl -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{
    "glassItem": {
      "stable_id": "test-001-0",
      "name": "Test Glass",
      "manufacturer": "test",
      "code": "001"
    },
    "image": "'"$TEST_IMAGE"'",
    "hasPermission": true,
    "offersFreeOfCharge": true
  }' | jq '.'
echo ""
echo "---"
echo ""

# Test 3: Invalid email
echo "Test 3: Invalid email (should fail)"
curl -X POST "$URL" \
  -H "Content-Type": application/json" \
  -d '{
    "glassItem": {
      "stable_id": "test-001-0",
      "name": "Test Glass",
      "manufacturer": "test",
      "code": "001"
    },
    "email": "not-an-email",
    "image": "'"$TEST_IMAGE"'",
    "hasPermission": true,
    "offersFreeOfCharge": true
  }' | jq '.'
echo ""
echo "---"
echo ""

# Test 4: Terms not accepted
echo "Test 4: Terms not accepted (should fail)"
curl -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{
    "glassItem": {
      "stable_id": "test-001-0",
      "name": "Test Glass",
      "manufacturer": "test",
      "code": "001"
    },
    "email": "test@example.com",
    "image": "'"$TEST_IMAGE"'",
    "hasPermission": false,
    "offersFreeOfCharge": true
  }' | jq '.'
echo ""
echo "---"
echo ""

# Test 5: Invalid base64
echo "Test 5: Invalid base64 image (should fail)"
curl -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{
    "glassItem": {
      "stable_id": "test-001-0",
      "name": "Test Glass",
      "manufacturer": "test",
      "code": "001"
    },
    "email": "test@example.com",
    "image": "not-base64!@#$",
    "hasPermission": true,
    "offersFreeOfCharge": true
  }' | jq '.'
echo ""

echo "Tests complete!"
