FROM node:22-alpine
WORKDIR /app
RUN adduser -D appuser
RUN chown appuser /app
COPY --chown=appuser . .
USER appuser
RUN npm install
RUN wget https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -f http://localhost:3000/health-check || exit 1
CMD ["node", "server.js"]
