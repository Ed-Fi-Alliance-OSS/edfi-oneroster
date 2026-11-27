# SPDX-License-Identifier: Apache-2.0
# Licensed to 1EdTech Consortium, Inc. under one or more agreements.
# 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
# See the LICENSE and NOTICES files in the project root for more information.

FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
WORKDIR /app
RUN adduser -D appuser && \
    chown appuser /app
COPY --chown=appuser . .
RUN apk add --no-cache curl postgresql18-client
USER appuser
RUN npm ci
RUN wget -q https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
EXPOSE 3000
CMD ["/bin/sh", "-c", "node server.js"]
