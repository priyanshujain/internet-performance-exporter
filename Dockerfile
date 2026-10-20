FROM node:24-alpine
RUN apk add --no-cache chromium tini
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js ./
ENV CHROMIUM_PATH=/usr/bin/chromium
USER node
EXPOSE 9798
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
