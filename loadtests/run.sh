#!/bin/bash
# Load Test Runner for EduTrack
# Usage: bash loadtests/run.sh [scenario] [base_url]
# Example: bash loadtests/run.sh smoke https://app-staging.example.com

set -e

SCENARIO=${1:-smoke}
BASE_URL=${2:-http://localhost:3000}

echo "=========================================="
echo " EduTrack Load Test Runner"
echo "=========================================="
echo " Scenario: $SCENARIO"
echo " Target:   $BASE_URL"
echo "=========================================="
echo ""

# Check if k6 is installed
if ! command -v k6 &> /dev/null; then
    echo "ERROR: k6 is not installed."
    echo "Install with: winget install k6"
    echo "Or visit: https://k6.io/docs/get-started/installation/"
    exit 1
fi

# Check for auth tokens
if [ -f "loadtests/data/tokens.json" ]; then
    echo "Found auth tokens in loadtests/data/tokens.json"
    ADMIN_TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('loadtests/data/tokens.json','utf8')).admin)")
    STAFF_TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('loadtests/data/tokens.json','utf8')).teacher)")
    export ADMIN_TOKEN
    export STAFF_TOKEN
    echo "Admin token loaded: ${ADMIN_TOKEN:0:20}..."
else
    echo "WARNING: No auth tokens found. Authenticated endpoints will be skipped."
    echo "Run 'npm run loadtest:setup' first to generate tokens."
fi

export BASE_URL

# Run the selected scenario
case $SCENARIO in
    smoke)
        echo "Running Smoke Test..."
        k6 run -e BASE_URL="$BASE_URL" -e ADMIN_TOKEN="$ADMIN_TOKEN" -e STAFF_TOKEN="$STAFF_TOKEN" loadtests/scenarios/smoke.ts
        ;;
    load)
        echo "Running Load Test (16 min)..."
        k6 run -e BASE_URL="$BASE_URL" -e ADMIN_TOKEN="$ADMIN_TOKEN" -e STAFF_TOKEN="$STAFF_TOKEN" loadtests/scenarios/load.ts
        ;;
    stress)
        echo "Running Stress Test (35 min)..."
        k6 run -e BASE_URL="$BASE_URL" -e ADMIN_TOKEN="$ADMIN_TOKEN" -e STAFF_TOKEN="$STAFF_TOKEN" loadtests/scenarios/stress.ts
        ;;
    spike)
        echo "Running Spike Test (12 min)..."
        k6 run -e BASE_URL="$BASE_URL" -e ADMIN_TOKEN="$ADMIN_TOKEN" -e STAFF_TOKEN="$STAFF_TOKEN" loadtests/scenarios/spike.ts
        ;;
    soak)
        echo "Running Soak Test (60 min)..."
        k6 run -e BASE_URL="$BASE_URL" -e ADMIN_TOKEN="$ADMIN_TOKEN" -e STAFF_TOKEN="$STAFF_TOKEN" loadtests/scenarios/soak.ts
        ;;
    scalability)
        echo "Running Scalability Test (15 min)..."
        k6 run -e BASE_URL="$BASE_URL" -e ADMIN_TOKEN="$ADMIN_TOKEN" -e STAFF_TOKEN="$STAFF_TOKEN" loadtests/scenarios/scalability.ts
        ;;
    all)
        echo "Running all tests sequentially..."
        echo "=== SMOKE TEST ==="
        k6 run -e BASE_URL="$BASE_URL" -e ADMIN_TOKEN="$ADMIN_TOKEN" -e STAFF_TOKEN="$STAFF_TOKEN" loadtests/scenarios/smoke.ts
        echo ""
        echo "=== LOAD TEST ==="
        k6 run -e BASE_URL="$BASE_URL" -e ADMIN_TOKEN="$ADMIN_TOKEN" -e STAFF_TOKEN="$STAFF_TOKEN" loadtests/scenarios/load.ts
        echo ""
        echo "=== SPIKE TEST ==="
        k6 run -e BASE_URL="$BASE_URL" -e ADMIN_TOKEN="$ADMIN_TOKEN" -e STAFF_TOKEN="$STAFF_TOKEN" loadtests/scenarios/spike.ts
        ;;
    *)
        echo "Unknown scenario: $SCENARIO"
        echo "Available: smoke, load, stress, spike, soak, scalability, all"
        exit 1
        ;;
esac

echo ""
echo "=========================================="
echo " Test complete!"
echo "=========================================="
