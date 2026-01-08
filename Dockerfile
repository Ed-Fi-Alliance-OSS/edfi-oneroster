# SPDX-License-Identifier: Apache-2.0
# Licensed to EdTech Consortium, Inc. under one or more agreements.
# EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
# See the LICENSE and NOTICES files in the project root for more information.

FROM node:22-alpine@sha256:0340fa682d72068edf603c305bfbc10e23219fb0e40df58d9ea4d6f33a9798bf
WORKDIR /app
RUN adduser -D appuser
RUN chown appuser /app
COPY --chown=appuser . .
USER appuser
RUN npm ci
RUN wget https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -f http://localhost:3000/health-check || exit 1
CMD ["node", "server.js"]
