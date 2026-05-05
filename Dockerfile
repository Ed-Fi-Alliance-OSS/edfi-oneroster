# SPDX-License-Identifier: Apache-2.0
# Licensed to EdTech Consortium, Inc. under one or more agreements.
# EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
# See the LICENSE and NOTICES files in the project root for more information.

FROM node:22-alpine@sha256:0340fa682d72068edf603c305bfbc10e23219fb0e40df58d9ea4d6f33a9798bf
WORKDIR /app
RUN adduser -D appuser && \
    chown appuser /app
COPY --chown=appuser . .
RUN apk add --no-cache curl=8.17.0-r1 postgresql18-client=18.3-r0
USER appuser
RUN npm ci
RUN wget -q https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
EXPOSE 3000
CMD ["/bin/sh", "-c", "node server.js"]
