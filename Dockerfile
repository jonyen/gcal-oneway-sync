# Use Node.js 20 LTS version (compatible with latest npm)
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Update npm to latest version and install dependencies
RUN npm install -g npm@latest && npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --omit=dev

# Expose port (Cloud Run will set PORT env var)
EXPOSE 8080

# Command to run the HTTP server
CMD ["node", "dist/server.js"]