#!/bin/bash

# SPDX-License-Identifier: Apache-2.0
# Licensed to EdTech Consortium, Inc. under one or more agreements.
# EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
# See the LICENSE and NOTICES files in the project root for more information.

set -e
set -x

# Handle Windows pathing for subject
if [ $(uname | cut -c1-10) = "MINGW64_NT" ]; then
  subj="//CN=localhost"
else
  subj="/CN=localhost"
fi

openssl dhparam -out dhparam.pem 2048
openssl req -subj "$subj" -x509 -newkey rsa:2048 -nodes -keyout server.key -out server.crt -days 365 -addext "subjectAltName=DNS:localhost,DNS:nginx"
