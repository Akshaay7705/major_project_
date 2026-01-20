# Use Node.js LTS (Long Term Support)
FROM node:18-alpine AS base
# Install pnpm (required for workspace management)
RUN npm install -g pnpm
# Set working directory
WORKDIR /app
# Copy root workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
# Copy the knowledge bank (CRITICAL for your app)
COPY knowledge_bank.json ./
# Copy all source code (monorepo structure)
COPY apps ./apps
COPY packages ./packages
# Install dependencies
RUN pnpm install --frozen-lockfile
# Build the project (demo app)
# We navigate to the demo app to run the build command
WORKDIR /app/apps/demo
RUN pnpm run build
# Expose the port Next.js runs on
EXPOSE 3000
# Start the application
CMD ["pnpm", "start"]