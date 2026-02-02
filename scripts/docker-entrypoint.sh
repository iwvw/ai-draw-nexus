#!/bin/sh

echo "=== ENTRYPOINT DEBUG ==="
echo "Working directory: $(pwd)"
ls -la

# Construct bindings and .dev.vars
BINDINGS=""
rm -f .dev.vars
touch .dev.vars

add_var() {
  VAR_NAME="$1"
  if [ -n "$(eval echo \$$VAR_NAME)" ]; then
    VAL="$(eval echo \$$VAR_NAME)"
    # 1. Add to .dev.vars
    echo "$VAR_NAME=$VAL" >> .dev.vars
    
    # 2. Add to bindings args
    BINDINGS="$BINDINGS --binding $VAR_NAME=$VAL"
    
    # Debug print
    LEN=${#VAL}
    if [ "$LEN" -gt 5 ]; then
      echo "Loaded $VAR_NAME (length: $LEN, starts with: $(echo $VAL | cut -c1-3)...)"
    else
      echo "Loaded $VAR_NAME (length: $LEN)"
    fi
  else
    echo "WARNING: $VAR_NAME is NOT set in environment!"
  fi
}

add_var "AI_API_KEY"
add_var "AI_BASE_URL"
add_var "AI_PROVIDER"
add_var "AI_MODEL_ID"
add_var "ACCESS_PASSWORD"
add_var "DAILY_QUOTA"

echo "=== .dev.vars content ==="
cat .dev.vars | sed 's/KEY=.*/KEY=***/' | sed 's/PASSWORD=.*/PASSWORD=***/'

echo "=== Executing Wrangler ==="
# Use exec to run wrangler
exec npx wrangler pages dev dist --ip 0.0.0.0 --port 8787 --no-live-reload $BINDINGS
