# The build stages run on the build machine's own architecture (the UI is
# architecture-independent and Go cross-compiles), so a multi-arch build never
# runs npm or the Go toolchain under emulation. Only the runtime stage is per-arch.

# Stage 1: Build frontend
FROM --platform=$BUILDPLATFORM node:24-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# The icon bundle generator also reads the backend's fixtures, icon seeds and the
# fresh-install Sample (backend/internal), so they must be here for the build.
COPY backend/internal/ /app/backend/internal/
RUN npm run build

# Stage 2: Build backend (with the frontend embedded)
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS backend-builder
ARG TARGETOS
ARG TARGETARCH
# A pre-release label ("rc1") from the release workflow; empty for a release.
ARG PRERELEASE=""
WORKDIR /app/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
# Embed the compiled SPA into the binary. //go:embed can't reach outside the
# Go module, so stage the build inside the backend tree before compiling.
COPY --from=frontend-builder /app/frontend/build ./internal/web/build
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} go build -ldflags="-s -w -X github.com/weaversgrainthorpe/HOPS/internal/version.Prerelease=${PRERELEASE}" -o hops ./cmd/hops

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
