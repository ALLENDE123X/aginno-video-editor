#!/bin/bash

# Navigate to the API directory
cd api

# Install all dependencies from package.json
npm install

# Install additional type dependencies to fix linter errors
npm install --save-dev @types/uuid
npm install --save-dev @types/express @types/cors @types/multer

# Navigate back to the root directory
cd ..

echo "API dependencies installed successfully!" 