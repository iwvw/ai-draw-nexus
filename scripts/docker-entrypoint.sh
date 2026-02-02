#!/bin/sh

# Construct bindings arguments
BINDINGS=""

add_binding() {
  if [ -n "$(eval echo \$$1)" ]; then
    VAL="$(eval echo \$$1)"
    # We need to be careful with quotes if value has spaces, but API keys usually don't.
    BINDINGS="$BINDINGS --binding $1=$VAL"
  fi
}

add_binding "AI_API_KEY"
add_binding "AI_BASE_URL"
add_binding "AI_PROVIDER"
add_binding "AI_MODEL_ID"
add_binding "ACCESS_PASSWORD"
add_binding "DAILY_QUOTA"

echo "Starting wrangler with bindings..."
# Mask secrets in logs
echo "Bindings configured: AI_API_KEY, AI_BASE_URL, AI_PROVIDER, etc."

# Use exec to run wrangler
# Note: "dist" is the directory argument
exec npx wrangler pages dev dist --ip 0.0.0.0 --port 8787 --no-live-reload $BINDINGS
