# Stage 1: Build frontend
FROM node:24-alpine AS frontend-builder
RUN corepack enable
WORKDIR /app/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

# Stage 2: Build backend
FROM golang:1.24-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o hops ./cmd/hops

# Stage 3: Runtime
FROM alpine:3.21
RUN apk add --no-cache ca-certificates
RUN adduser -D -h /app hops
WORKDIR /app

COPY --from=backend-builder /app/backend/hops ./hops
COPY --from=frontend-builder /app/frontend/build ./frontend/build

RUN mkdir -p /app/data && chown -R hops:hops /app
USER hops

EXPOSE 8080
VOLUME ["/app/data"]

ENTRYPOINT ["./hops"]
CMD ["--port", "8080", "--data", "/app/data", "--frontend", "/app/frontend/build"]
