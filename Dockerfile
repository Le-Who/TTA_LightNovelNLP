# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install

# Copy source code
COPY . .

# Build args for API Key (Vite requires these at build time to bake them in)
ARG GEMINI_API_KEY
ENV GEMINI_API_KEY=$GEMINI_API_KEY

# Build the application
RUN npm run build

# Stage 2: Serve
FROM nginx:alpine

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom Nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
