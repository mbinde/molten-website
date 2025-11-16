#!/bin/bash

# Test script for the color image generation API
# Usage: ./test-color-image.sh

set -e

echo "Testing Color Image Generation API"
echo "===================================="
echo ""

# Test 1: Modern style with glass colors
echo "Test 1: Modern style with Bullseye colors"
echo "Colors: Light Blue (#4A90E2), Amber (#F5A623), Lime Green (#7ED321)"
echo ""

curl -X POST http://localhost:8788/api/v1/generate-color-image \
  -H "Content-Type: application/json" \
  -d '{
    "colors": [
      {"hex": "#4A90E2", "weight": 0.4},
      {"hex": "#F5A623", "weight": 0.3},
      {"hex": "#7ED321", "weight": 0.2},
      {"hex": "#50E3C2", "weight": 0.1}
    ],
    "style": ["modern", "minimalist"],
    "width": 512,
    "height": 512
  }' \
  --output test-modern.png

echo "✓ Saved to test-modern.png"
echo ""

# Test 2: Spooky Halloween colors
echo "Test 2: Spooky Halloween colors"
echo "Colors: Orange (#FF8C00), Purple (#800080), Black (#000000)"
echo ""

curl -X POST http://localhost:8788/api/v1/generate-color-image \
  -H "Content-Type: application/json" \
  -d '{
    "colors": [
      {"hex": "#FF8C00", "weight": 0.4},
      {"hex": "#800080", "weight": 0.3},
      {"hex": "#000000", "weight": 0.3}
    ],
    "style": ["spooky", "dark", "halloween"],
    "width": 512,
    "height": 512
  }' \
  --output test-spooky.png

echo "✓ Saved to test-spooky.png"
echo ""

# Test 3: Christmas colors
echo "Test 3: Christmas colors"
echo "Colors: Red (#DC143C), Green (#006400), Gold (#FFD700)"
echo ""

curl -X POST http://localhost:8788/api/v1/generate-color-image \
  -H "Content-Type: application/json" \
  -d '{
    "colors": [
      {"hex": "#DC143C", "weight": 0.4},
      {"hex": "#006400", "weight": 0.4},
      {"hex": "#FFD700", "weight": 0.2}
    ],
    "style": ["festive", "christmas", "elegant"],
    "width": 512,
    "height": 512
  }' \
  --output test-christmas.png

echo "✓ Saved to test-christmas.png"
echo ""

echo "===================================="
echo "All tests complete!"
echo "Check test-modern.png, test-spooky.png, and test-christmas.png"
