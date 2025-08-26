FROM node:20
WORKDIR /app
COPY . .
RUN npm install
RUN wget https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
EXPOSE 3000
CMD ["node", "server.js"]
