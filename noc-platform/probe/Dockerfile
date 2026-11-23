# noc-probe: static Go binary on a minimal image (CA certificates included).
FROM golang:1.25 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /noc-probe .

FROM gcr.io/distroless/static-debian12
COPY --from=build /noc-probe /noc-probe
# Raw ICMP needs CAP_NET_RAW: run with --cap-add NET_RAW (docker-compose does this).
ENTRYPOINT ["/noc-probe"]
