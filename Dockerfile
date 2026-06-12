# Stage 1: build the frontend
FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: build the static Go binary (modernc sqlite = pure Go, CGO off)
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/web/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /lanshare .

# Stage 3: scratch runtime — just the binary
FROM scratch
COPY --from=build /lanshare /lanshare
ENV DATA_DIR=/data \
    PORT=10088
VOLUME /data
EXPOSE 10088
ENTRYPOINT ["/lanshare"]
