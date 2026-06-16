# Stage 1: Build frontend
FROM node:24-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend (with the frontend embedded)
FROM golang:1.25-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
# Embed the compiled SPA into the binary. //go:embed can't reach outside the
# Go module, so stage the build inside the backend tree before compiling.
COPY --from=frontend-builder /app/frontend/build ./internal/web/build
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o hops ./cmd/hops

# Stage 3: Runtime — just the self-contained binary.
FROM alpine:3.21
RUN apk add --no-cache ca-certificates
RUN adduser -D -h /app hops
WORKDIR /app

COPY --from=backend-builder /app/backend/hops ./hops

RUN mkdir -p /app/data && chown -R hops:hops /app
USER hops

EXPOSE 8080
VOLUME ["/app/data"]

ENTRYPOINT ["./hops"]
CMD ["--data", "/app/data"]
