FROM ubuntu:24.04 AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
      cmake g++ make libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DEMRS_BUILD_TESTS=OFF \
 && cmake --build build -j"$(nproc)" --target emrs_server

FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends libssl3t64 curl && rm -rf /var/lib/apt/lists/* \
 && useradd -r -u 10001 emrs && mkdir /data && chown emrs /data
WORKDIR /app
COPY --from=build /src/build/emrs_server /app/emrs_server
COPY web /app/web
USER emrs
ENV EMRS_DB=/data/emrs.db EMRS_PORT=8080 EMRS_WEB_DIR=/app/web
EXPOSE 8080
VOLUME /data
CMD ["/app/emrs_server"]
