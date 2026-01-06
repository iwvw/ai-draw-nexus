#!/bin/bash

# Exit on error
set -e

# 1. Build the project
echo "Building the project..."
pnpm run build

# 2. Upload to OSS
echo "Uploading to Alibaba Cloud OSS..."
# Make sure ossutil is configured with your credentials
# ossutil config -e <endpoint> -i <accessKeyId> -k <accessKeySecret>

# Replace with your bucket name and desired remote path
BUCKET_NAME="your-bucket-name"
REMOTE_PATH="your-remote-path/"

# Upload the dist directory
ossutil cp -r dist/ "oss://${BUCKET_NAME}/${REMOTE_PATH}"

echo "Deployment to OSS completed."
