#!/bin/sh

# Create .dev.vars file from environment variables
# Wrangler pages dev reads secrets/environment variables from this file

echo "Generating .dev.vars from environment variables..."
touch .dev.vars

# Function to add env var if it exists
add_env() {
  if [ -n "$(eval echo \$$1)" ]; then
    echo "$1=$(eval echo \$$1)" >> .dev.vars
  fi
}

# Add specific variables
add_env "AI_API_KEY"
add_env "AI_BASE_URL"
add_env "AI_PROVIDER"
add_env "AI_MODEL_ID"
add_env "ACCESS_PASSWORD"
add_env "DAILY_QUOTA"

echo ".dev.vars content preview (hiding secrets):"
grep -v "KEY\|PASSWORD" .dev.vars || true

# Execute the passed command
exec "$@"
